/**
 * Fasi di ANAGRAFICHE dal pezzo I4: sedi, produttori, trasportatori, destinatari, automezzi.
 * SQL parametrizzato; `ON CONFLICT` sul solo bersaglio della chiave legacy (come `inserisciDitte`).
 *
 * Le parti si legano per chiave legacy dentro il blocco: la ditta e' quella con `dittaId` (aggancio
 * della mappa) oppure la ditta importata con quella chiave; la sede predefinita e il trasportatore
 * si leggono con `SELECT ... WHERE tenant_id AND import_source = 'WINWASTE' AND legacy_key`. Un
 * riferimento che non si risolve ferma il blocco (errore senza valori), mai una riga orfana.
 *
 * Un ruolo (produttore, trasportatore, destinatario) e' unico per ditta: se una ditta AGGANCIATA ha
 * gia' il suo ruolo (nato in WasteFlow, senza provenienza), il ruolo del pacchetto non si inserisce
 * (riga «saltata»): il ruolo esistente non si tocca. Gli automezzi di quel trasportatore restano
 * senza proprietario (parco proprio), perche' la chiave legacy non punta al ruolo esistente.
 */
import type {
  RecordAutomezzo,
  RecordDestinatario,
  RecordProduttore,
  RecordSede,
  RecordTrasportatore,
  RiferimentoDitta,
} from '../pacchetto/record-anagrafiche'
import type { ContestoBlocco, InserisciBlocco, Tx } from './tipi'

/** Utente tecnico di `automezzi.creato_da` (NOT NULL) per i record importati senza operatore. */
/** Diverso dall'id dell'azienda piattaforma (`...0001`): in audit non si confondono. */
export const CREATO_DA_IMPORTAZIONE = '00000000-0000-4000-8000-000000000002'

/** Un riferimento fra record del pacchetto non si risolve nel database. Mai valori nel messaggio. */
export class RiferimentoNonRisoltoError extends Error {
  constructor(readonly oggetto: 'ditta' | 'sede') {
    super(`riferimento a ${oggetto} non risolto: la fase precedente non ha scritto la riga`)
    this.name = 'RiferimentoNonRisoltoError'
  }
}

async function idDitta(
  tx: Tx,
  tenantId: string,
  r: RiferimentoDitta,
  cache: Map<string, string>
): Promise<string> {
  if (r.dittaId !== null) return r.dittaId
  const noto = cache.get(r.dittaKey)
  if (noto) return noto
  const [riga] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ditte"
    WHERE "tenant_id" = ${tenantId}::uuid AND "import_source" = 'WINWASTE'
      AND "legacy_key" = ${r.dittaKey}`
  if (!riga) throw new RiferimentoNonRisoltoError('ditta')
  cache.set(r.dittaKey, riga.id)
  return riga.id
}

async function idSede(
  tx: Tx,
  tenantId: string,
  dittaId: string,
  sedeKey: string,
  cache: Map<string, string>
): Promise<string> {
  const k = `${dittaId}|${sedeKey}`
  const noto = cache.get(k)
  if (noto) return noto
  const [riga] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "sedi_ditte"
    WHERE "tenant_id" = ${tenantId}::uuid AND "ditta_id" = ${dittaId}::uuid
      AND "import_source" = 'WINWASTE' AND "legacy_key" = ${sedeKey}`
  if (!riga) throw new RiferimentoNonRisoltoError('sede')
  cache.set(k, riga.id)
  return riga.id
}

export const inserisciSedi: InserisciBlocco<RecordSede> = async (
  tx: Tx,
  righe: readonly RecordSede[],
  c: ContestoBlocco
): Promise<number> => {
  const ditte = new Map<string, string>()
  let inserite = 0
  for (const r of righe) {
    const dittaId = await idDitta(tx, c.tenantId, r, ditte)
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "sedi_ditte"
        ("tenant_id", "ditta_id", "denominazione", "via", "civico", "cap", "comune", "provincia",
         "telefono", "principale", "attiva", "import_source", "legacy_key", "lotto_import_id",
         "updated_at")
      VALUES
        (${c.tenantId}::uuid, ${dittaId}::uuid, ${r.denominazione}, ${r.via}, ${r.civico}, ${r.cap},
         ${r.comune}, ${r.provincia}, ${r.telefono}, ${r.principale}, true, 'WINWASTE',
         ${r.legacyKey}, ${c.lottoId}::uuid, now())
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}

type TabellaRuolo = 'produttori' | 'trasportatori' | 'destinatari'

/** Il ruolo esiste gia' per la ditta con un'altra provenienza (o nessuna): non si duplica. */
async function ruoloGiaPresente(
  tx: Tx,
  tabella: TabellaRuolo,
  tenantId: string,
  dittaId: string,
  legacyKey: string
): Promise<boolean> {
  // Una query per tabella (nomi fissi, SQL parametrizzato): niente SQL costruito da stringhe.
  const righe =
    tabella === 'produttori'
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "produttori"
          WHERE "tenant_id" = ${tenantId}::uuid AND "ditta_id" = ${dittaId}::uuid
            AND ("import_source" IS DISTINCT FROM 'WINWASTE' OR "legacy_key" <> ${legacyKey})
          LIMIT 1`
      : tabella === 'trasportatori'
        ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "trasportatori"
          WHERE "tenant_id" = ${tenantId}::uuid AND "ditta_id" = ${dittaId}::uuid
            AND ("import_source" IS DISTINCT FROM 'WINWASTE' OR "legacy_key" <> ${legacyKey})
          LIMIT 1`
        : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "destinatari"
          WHERE "tenant_id" = ${tenantId}::uuid AND "ditta_id" = ${dittaId}::uuid
            AND ("import_source" IS DISTINCT FROM 'WINWASTE' OR "legacy_key" <> ${legacyKey})
          LIMIT 1`
  return righe.length > 0
}

async function contesto(
  tx: Tx,
  tabella: TabellaRuolo,
  r: RecordProduttore,
  c: ContestoBlocco,
  ditte: Map<string, string>,
  sedi: Map<string, string>
): Promise<{ dittaId: string; sedeId: string } | null> {
  const dittaId = await idDitta(tx, c.tenantId, r, ditte)
  if (await ruoloGiaPresente(tx, tabella, c.tenantId, dittaId, r.legacyKey)) return null
  return { dittaId, sedeId: await idSede(tx, c.tenantId, dittaId, r.sedeKey, sedi) }
}

export const inserisciProduttori: InserisciBlocco<RecordProduttore> = async (tx, righe, c) => {
  const ditte = new Map<string, string>()
  const sedi = new Map<string, string>()
  let inserite = 0
  for (const r of righe) {
    const rif = await contesto(tx, 'produttori', r, c, ditte, sedi)
    if (!rif) continue
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "produttori"
        ("tenant_id", "ditta_id", "sede_id", "import_source", "legacy_key", "lotto_import_id",
         "updated_at")
      VALUES (${c.tenantId}::uuid, ${rif.dittaId}::uuid, ${rif.sedeId}::uuid, 'WINWASTE',
              ${r.legacyKey}, ${c.lottoId}::uuid, now())
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}

export const inserisciTrasportatori: InserisciBlocco<RecordTrasportatore> = async (
  tx,
  righe,
  c
) => {
  const ditte = new Map<string, string>()
  const sedi = new Map<string, string>()
  let inserite = 0
  for (const r of righe) {
    const rif = await contesto(tx, 'trasportatori', r, c, ditte, sedi)
    if (!rif) continue
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "trasportatori"
        ("tenant_id", "ditta_id", "sede_id", "numero_iscrizione", "scadenza_iscrizione",
         "import_source", "legacy_key", "lotto_import_id", "updated_at")
      VALUES (${c.tenantId}::uuid, ${rif.dittaId}::uuid, ${rif.sedeId}::uuid, ${r.numeroIscrizione},
              ${r.scadenzaIscrizione}::date, 'WINWASTE', ${r.legacyKey}, ${c.lottoId}::uuid, now())
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}

export const inserisciDestinatari: InserisciBlocco<RecordDestinatario> = async (tx, righe, c) => {
  const ditte = new Map<string, string>()
  const sedi = new Map<string, string>()
  let inserite = 0
  for (const r of righe) {
    const rif = await contesto(tx, 'destinatari', r, c, ditte, sedi)
    if (!rif) continue
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "destinatari"
        ("tenant_id", "ditta_id", "sede_id", "numero_autorizzazione", "scadenza_autorizzazione",
         "import_source", "legacy_key", "lotto_import_id", "updated_at")
      VALUES (${c.tenantId}::uuid, ${rif.dittaId}::uuid, ${rif.sedeId}::uuid,
              ${r.numeroAutorizzazione}, ${r.scadenzaAutorizzazione}::date, 'WINWASTE',
              ${r.legacyKey}, ${c.lottoId}::uuid, now())
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}

export const inserisciAutomezzi: InserisciBlocco<RecordAutomezzo> = async (tx, righe, c) => {
  const [lotto] = await tx.$queryRaw<Array<{ operatore: string | null }>>`
    SELECT "avviato_da"::text AS operatore FROM "lotti_import"
    WHERE "id" = ${c.lottoId}::uuid AND "tenant_id" = ${c.tenantId}::uuid`
  const creatoDa = lotto?.operatore ?? CREATO_DA_IMPORTAZIONE
  const trasportatori = new Map<string, string | null>()
  let inserite = 0
  for (const r of righe) {
    let trasportatoreId: string | null = null
    if (r.trasportatoreKey !== null) {
      if (!trasportatori.has(r.trasportatoreKey)) {
        const [t] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "trasportatori"
          WHERE "tenant_id" = ${c.tenantId}::uuid AND "import_source" = 'WINWASTE'
            AND "legacy_key" = ${r.trasportatoreKey}`
        trasportatori.set(r.trasportatoreKey, t?.id ?? null)
      }
      trasportatoreId = trasportatori.get(r.trasportatoreKey) ?? null
    }
    // La tara dell'anagrafica WinWaste e' DICHIARATA (non c'e' una pesata): il CHECK vuole insieme
    // kg, origine e data di aggiornamento.
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "automezzi"
        ("tenant_id", "targa", "trasportatore_id", "tara_kg", "tara_origine", "tara_aggiornata_il",
         "note", "creato_da", "import_source", "legacy_key", "lotto_import_id", "updated_at")
      VALUES
        (${c.tenantId}::uuid, ${r.targa}, ${trasportatoreId}::uuid, ${r.taraKg}::numeric,
         CASE WHEN ${r.taraKg}::numeric IS NULL THEN NULL ELSE 'DICHIARATA'::"origine_tara" END,
         CASE WHEN ${r.taraKg}::numeric IS NULL THEN NULL ELSE now() END,
         ${r.note}, ${creatoDa}::uuid, 'WINWASTE', ${r.legacyKey}, ${c.lottoId}::uuid, now())
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}
