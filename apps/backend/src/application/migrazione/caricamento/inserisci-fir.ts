/**
 * Fase `fir` (ambito FIR, pezzo I5): scrittura di un blocco di FIR cartacei/vidimati da WinWaste.
 * SQL parametrizzato; `ON CONFLICT` sul solo bersaglio della chiave legacy, cosi' un conflitto su un
 * ALTRO unico (`firs_tenant_id_fir_number_key`: stesso numero gia' in azienda) fa FALLIRE il blocco
 * invece di sparire. `firNumber` e' quello di WinWaste, mai rinominato.
 *
 * Il FIR importato nasce SEMPRE `bloccato_invio` (trigger `firs_blocco_invio_importati`): non viene
 * mai trasmesso a RENTRI finche' la riconciliazione non e' chiusa (3.6). Nessun legame RENTRI:
 * `rentri_numero_fir` resta nullo (il legame si fa in riconciliazione, non qui).
 *
 * Lo snapshot anagrafico (nome, partita IVA, indirizzo) si legge dalla ditta e dalla sede GIA'
 * presenti nel database (fase ANAGRAFICHE, o ditta agganciata): se mancano, il blocco fallisce con
 * un errore senza valori e il lotto e' `FALLITO`. L'operatore (`producer_user_id`, FK a `users`) e'
 * quello che ha avviato il lotto (`--operatore`).
 */
import type { ParteFir, RecordFir } from '../pacchetto/record-fir'
import { RiferimentoNonRisoltoError } from './inserisci-anagrafiche'
import type { ContestoBlocco, InserisciBlocco, Tx } from './tipi'

export const MOTIVO_BLOCCO_FIR_IMPORTATO =
  'Importato: invio a RENTRI bloccato fino alla riconciliazione'

/** Il lotto FIR non ha un operatore (`avviato_da`): il FIR non ha un utente a cui attribuirlo. */
export class OperatoreAssenteError extends Error {
  constructor() {
    super("Lotto senza operatore: il FIR importato richiede l'utente che avvia il caricamento")
    this.name = 'OperatoreAssenteError'
  }
}

interface Snapshot {
  readonly ruoloId: string | null
  readonly sedeId: string | null
  readonly nome: string
  readonly partitaIva: string
  readonly codiceFiscale: string | null
  readonly indirizzo: string
}

const VUOTO: Snapshot = {
  ruoloId: null,
  sedeId: null,
  nome: '',
  partitaIva: '',
  codiceFiscale: null,
  indirizzo: '',
}

type TabellaRuolo = 'produttori' | 'trasportatori' | 'destinatari'

async function idRuolo(
  tx: Tx,
  tabella: TabellaRuolo,
  tenantId: string,
  dittaId: string
): Promise<string | null> {
  // Una query per tabella (nomi fissi, SQL parametrizzato). Un ruolo e' unico per ditta.
  const righe =
    tabella === 'produttori'
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "produttori" WHERE "tenant_id" = ${tenantId}::uuid AND "ditta_id" = ${dittaId}::uuid LIMIT 1`
      : tabella === 'trasportatori'
        ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "trasportatori" WHERE "tenant_id" = ${tenantId}::uuid AND "ditta_id" = ${dittaId}::uuid LIMIT 1`
        : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "destinatari" WHERE "tenant_id" = ${tenantId}::uuid AND "ditta_id" = ${dittaId}::uuid LIMIT 1`
  return righe[0]?.id ?? null
}

interface Sede {
  readonly id: string
  readonly dittaId: string
  readonly indirizzo: string
}

function indirizzoDi(s: {
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
}): string {
  return `${s.via} ${s.civico}, ${s.cap} ${s.comune} (${s.provincia})`.slice(0, 500)
}

class Risolutore {
  private readonly ditte = new Map<
    string,
    { id: string; nome: string; piva: string | null; cf: string | null }
  >()
  private readonly sediPerChiave = new Map<string, Sede>()
  private readonly sediPerId = new Map<string, Sede>()
  private readonly ruoli = new Map<string, string | null>()

  constructor(
    private readonly tx: Tx,
    private readonly tenantId: string
  ) {}

  private async ditta(id: string) {
    const noto = this.ditte.get(id)
    if (noto) return noto
    const [d] = await this.tx.$queryRaw<
      Array<{ ragione_sociale: string; partita_iva: string | null; codice_fiscale: string | null }>
    >`SELECT "ragione_sociale", "partita_iva", "codice_fiscale" FROM "ditte"
      WHERE "id" = ${id}::uuid AND "tenant_id" = ${this.tenantId}::uuid`
    if (!d) throw new RiferimentoNonRisoltoError('ditta')
    const v = { id, nome: d.ragione_sociale, piva: d.partita_iva, cf: d.codice_fiscale }
    this.ditte.set(id, v)
    return v
  }

  private async dittaPerChiave(parte: Extract<ParteFir, { tipo: 'ditta' }>): Promise<string> {
    if (parte.dittaId !== null) return parte.dittaId
    const [r] = await this.tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ditte"
      WHERE "tenant_id" = ${this.tenantId}::uuid AND "import_source" = 'WINWASTE'
        AND "legacy_key" = ${parte.dittaKey}`
    if (!r) throw new RiferimentoNonRisoltoError('ditta')
    return r.id
  }

  private async sedePerChiave(dittaId: string, chiave: string): Promise<Sede> {
    const k = `${dittaId}|${chiave}`
    const nota = this.sediPerChiave.get(k)
    if (nota) return nota
    const [s] = await this.tx.$queryRaw<
      Array<{
        id: string
        via: string
        civico: string
        cap: string
        comune: string
        provincia: string
      }>
    >`SELECT "id", "via", "civico", "cap", "comune", "provincia" FROM "sedi_ditte"
      WHERE "tenant_id" = ${this.tenantId}::uuid AND "ditta_id" = ${dittaId}::uuid
        AND "import_source" = 'WINWASTE' AND "legacy_key" = ${chiave}`
    if (!s) throw new RiferimentoNonRisoltoError('sede')
    const v = { id: s.id, dittaId, indirizzo: indirizzoDi(s) }
    this.sediPerChiave.set(k, v)
    return v
  }

  private async sedePerId(id: string): Promise<Sede> {
    const nota = this.sediPerId.get(id)
    if (nota) return nota
    const [s] = await this.tx.$queryRaw<
      Array<{
        ditta_id: string
        via: string
        civico: string
        cap: string
        comune: string
        provincia: string
      }>
    >`SELECT "ditta_id", "via", "civico", "cap", "comune", "provincia" FROM "sedi_ditte"
      WHERE "tenant_id" = ${this.tenantId}::uuid AND "id" = ${id}::uuid`
    if (!s) throw new RiferimentoNonRisoltoError('sede')
    const v = { id, dittaId: s.ditta_id, indirizzo: indirizzoDi(s) }
    this.sediPerId.set(id, v)
    return v
  }

  private async ruolo(tabella: TabellaRuolo, dittaId: string): Promise<string | null> {
    const k = `${tabella}|${dittaId}`
    if (!this.ruoli.has(k))
      this.ruoli.set(k, await idRuolo(this.tx, tabella, this.tenantId, dittaId))
    return this.ruoli.get(k) ?? null
  }

  async snapshot(parte: ParteFir | null, tabella: TabellaRuolo): Promise<Snapshot> {
    if (parte === null) return VUOTO
    let dittaId: string
    let sede: Sede | null
    let ruoloId: string | null = null
    if (parte.tipo === 'propria') {
      sede = await this.sedePerId(parte.sedeId)
      dittaId = sede.dittaId
    } else {
      dittaId = await this.dittaPerChiave(parte)
      sede = parte.sedeKey === null ? null : await this.sedePerChiave(dittaId, parte.sedeKey)
      ruoloId = await this.ruolo(tabella, dittaId)
    }
    const d = await this.ditta(dittaId)
    return {
      ruoloId,
      sedeId: sede?.id ?? null,
      nome: d.nome.slice(0, 255),
      partitaIva: d.piva ?? '',
      codiceFiscale: d.cf,
      indirizzo: sede?.indirizzo ?? '',
    }
  }
}

export const inserisciFir: InserisciBlocco<RecordFir> = async (
  tx: Tx,
  righe: readonly RecordFir[],
  c: ContestoBlocco
): Promise<number> => {
  const [lotto] = await tx.$queryRaw<Array<{ operatore: string | null }>>`
    SELECT "avviato_da"::text AS operatore FROM "lotti_import"
    WHERE "id" = ${c.lottoId}::uuid AND "tenant_id" = ${c.tenantId}::uuid`
  const operatore = lotto?.operatore ?? null
  if (operatore === null) throw new OperatoreAssenteError()
  const risolutore = new Risolutore(tx, c.tenantId)
  let inserite = 0
  for (const r of righe) {
    const prod = await risolutore.snapshot(r.produttore, 'produttori')
    const tras = await risolutore.snapshot(r.trasportatore, 'trasportatori')
    const dest = await risolutore.snapshot(r.destinatario, 'destinatari')
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "firs"
        ("tenant_id", "fir_number", "status", "producer_user_id",
         "producer_id", "producer_sede_id", "producer_codice_fiscale", "producer_partita_iva",
         "producer_name", "producer_address",
         "carrier_id", "carrier_codice_fiscale", "carrier_partita_iva", "carrier_name",
         "carrier_vehicle_plate",
         "receiver_id", "receiver_sede_id", "receiver_codice_fiscale", "receiver_partita_iva",
         "receiver_name", "receiver_address",
         "cer_code", "waste_description", "waste_category", "quantity", "unit",
         "waste_operation_type", "transport_date", "completed_at",
         "bloccato_invio", "motivo_blocco_invio",
         "import_source", "legacy_key", "lotto_import_id", "updated_at")
      VALUES
        (${c.tenantId}::uuid, ${r.firNumber}, ${r.stato}::"fir_status", ${operatore}::uuid,
         ${prod.ruoloId}::uuid, ${prod.sedeId}::uuid, ${prod.codiceFiscale}, ${prod.partitaIva},
         ${prod.nome}, ${prod.indirizzo},
         ${tras.ruoloId}::uuid, ${tras.codiceFiscale}, ${tras.partitaIva}, ${tras.nome},
         ${r.targa},
         ${dest.ruoloId}::uuid, ${dest.sedeId}::uuid, ${dest.codiceFiscale}, ${dest.partitaIva},
         ${dest.nome}, ${dest.indirizzo},
         ${r.cerCode}, ${r.descrizione}, ${r.pericoloso ? 'Pericoloso' : 'Non pericoloso'},
         ${r.quantitaKg}::numeric, 'kg',
         ${r.operazione}::"waste_operation_type", ${r.dataTrasporto}::date::timestamp,
         ${r.dataFine}::date::timestamp,
         true, ${MOTIVO_BLOCCO_FIR_IMPORTATO},
         'WINWASTE', ${r.legacyKey}, ${c.lottoId}::uuid, now())
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}
