/**
 * Fase `giacenze` (ambito GIACENZE, pezzo I6): scrittura di un blocco di giacenze iniziali al taglio.
 * SQL parametrizzato; `ON CONFLICT` sul solo bersaglio della chiave legacy, cosi' un conflitto su un
 * ALTRO unico (`giacenze_iniziali_registro_cer_stato_unita_key`: stessa famiglia gia' presente) fa
 * FALLIRE il blocco invece di sparire.
 *
 * REGOLE (piano I6, T2-T3):
 *  - una giacenza MANUALE (o importata con un'altra chiave) gia' presente sulla stessa famiglia
 *    (registro, CER sulle sole cifre, stato fisico, famiglia di unita' kg/t) fa fallire il blocco con
 *    una descrizione senza dati: non si sovrascrive MAI e non si somma;
 *  - la famiglia gia' importata con la stessa chiave si salta (riesecuzione idempotente);
 *  - il CER e' quello del catalogo (con `*` se il catalogo lo ha); fuori catalogo il blocco fallisce;
 *  - stesso advisory lock di scarico e servizio delle aperture (`chiaveLockGiacenza`): uno scarico
 *    concorrente o vede l'apertura o la aspetta;
 *  - `provenienza = IMPORTAZIONE`; `impostato_da` e' l'operatore che ha avviato il lotto.
 */
import { ALIAS_KG, ALIAS_T } from '../../../domain/waste-movement/unita-misura-registro'
import { chiaveLockGiacenza } from '../../registro/chiave-lock-giacenza'
import type { RecordGiacenza } from '../pacchetto/record-giacenze'
import { ErroreSenzaDati } from './errori'
import { OperatoreAssenteError } from './inserisci-fir'
import type { ContestoBlocco, InserisciBlocco, Tx } from './tipi'

export const NOTA_GIACENZA_IMPORTATA = 'Importata da WinWaste: giacenza al taglio'

export class GiacenzaGiaPresenteError extends ErroreSenzaDati {
  constructor() {
    super(
      'esiste gia una giacenza iniziale non importata per la stessa famiglia (registro, CER, ' +
        'stato fisico, unita): non si sovrascrive, va tolta a mano prima del caricamento'
    )
    this.name = 'GiacenzaGiaPresenteError'
  }
}

export class CerNonInCatalogoError extends ErroreSenzaDati {
  constructor() {
    super('un CER della giacenza non e nel catalogo CER')
    this.name = 'CerNonInCatalogoError'
  }
}

const cifre = (cer: string): string => cer.replace(/\D/g, '')

/** Forma del CER nel catalogo (con `*` se il catalogo lo ha), `null` se non esiste. */
export async function cerDelCatalogo(tx: Tx, cerCode: string): Promise<string | null> {
  const senza = cerCode.replace(/\*$/, '')
  const righe = await tx.$queryRaw<Array<{ code: string }>>`
    SELECT "code" FROM "cer_codes" WHERE "code" = ANY(${[senza, `${senza}*`]}::text[])`
  return righe.find(r => r.code.endsWith('*'))?.code ?? righe[0]?.code ?? null
}

/** Famiglie gia' in azienda, non importate con queste chiavi (`unita` in kg o t e' la stessa famiglia). */
export async function famiglieOccupate(
  tx: Tx,
  tenantId: string,
  righe: readonly RecordGiacenza[]
): Promise<number> {
  let n = 0
  for (const r of righe) {
    const [x] = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM "giacenze_iniziali"
      WHERE "tenant_id" = ${tenantId}::uuid AND "registro_id" = ${r.registroId}::uuid
        AND regexp_replace("cer_code", '[^0-9]', '', 'g') = ${cifre(r.cerCode)}
        AND "stato_fisico" IS NOT DISTINCT FROM ${r.statoFisico}
        AND (upper(btrim("unita")) = ANY(${[...ALIAS_KG, ...ALIAS_T]}::text[]) OR btrim("unita") = '')
        AND ("import_source" IS DISTINCT FROM 'WINWASTE' OR "legacy_key" <> ${r.legacyKey})`
    if (Number(x.n) > 0) n++
  }
  return n
}

export const inserisciGiacenze: InserisciBlocco<RecordGiacenza> = async (
  tx: Tx,
  righe: readonly RecordGiacenza[],
  c: ContestoBlocco
): Promise<number> => {
  const [lotto] = await tx.$queryRaw<Array<{ operatore: string | null }>>`
    SELECT "avviato_da"::text AS operatore FROM "lotti_import"
    WHERE "id" = ${c.lottoId}::uuid AND "tenant_id" = ${c.tenantId}::uuid`
  const operatore = lotto?.operatore ?? null
  if (operatore === null) throw new OperatoreAssenteError()
  let inserite = 0
  for (const r of righe) {
    const cer = await cerDelCatalogo(tx, r.cerCode)
    if (cer === null) throw new CerNonInCatalogoError()
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiaveLockGiacenza(r.registroId, cer)}))`
    // Gia' importata con questa chiave: saltata (la riesecuzione non confronta ne' riscrive).
    const [gia] = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM "giacenze_iniziali"
      WHERE "tenant_id" = ${c.tenantId}::uuid AND "import_source" = 'WINWASTE'
        AND "legacy_key" = ${r.legacyKey}`
    if (Number(gia.n) > 0) continue
    if ((await famiglieOccupate(tx, c.tenantId, [r])) > 0) throw new GiacenzaGiaPresenteError()
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "giacenze_iniziali"
        ("tenant_id", "registro_id", "cer_code", "stato_fisico", "quantita", "unita",
         "data_riferimento", "origini", "provenienza", "note", "impostato_da", "updated_at",
         "import_source", "legacy_key", "lotto_import_id")
      VALUES
        (${c.tenantId}::uuid, ${r.registroId}::uuid, ${cer}, ${r.statoFisico}, ${r.quantita}::numeric,
         ${r.unita}, ${r.dataRiferimento}::date, ${JSON.stringify(r.origini)}::jsonb,
         'IMPORTAZIONE'::"giacenza_iniziale_provenienza", ${NOTA_GIACENZA_IMPORTATA},
         ${operatore}::uuid, now(), 'WINWASTE', ${r.legacyKey}, ${c.lottoId}::uuid)
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}
