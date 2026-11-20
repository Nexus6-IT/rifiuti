/**
 * Fase `ditte` (ambito ANAGRAFICHE): scrittura di un blocco. SQL parametrizzato; `ON CONFLICT` sul
 * solo bersaglio della chiave legacy, cosi' un conflitto su un ALTRO unico (partita IVA o codice
 * fiscale di una ditta gia' presente e non agganciata) fa fallire il blocco invece di sparire.
 */
import type { RecordDitta } from '../pacchetto/record-ditta'
import type { ContestoBlocco, InserisciBlocco, Tx } from './tipi'

export const inserisciDitte: InserisciBlocco<RecordDitta> = async (
  tx: Tx,
  righe: readonly RecordDitta[],
  contesto: ContestoBlocco
): Promise<number> => {
  let inserite = 0
  for (const r of righe) {
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "ditte"
        ("tenant_id", "ragione_sociale", "partita_iva", "codice_fiscale",
         "import_source", "legacy_key", "lotto_import_id", "updated_at")
      VALUES
        (${contesto.tenantId}::uuid, ${r.ragioneSociale}, ${r.partitaIva}, ${r.codiceFiscale},
         'WINWASTE', ${r.legacyKey}, ${contesto.lottoId}::uuid, now())
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}
