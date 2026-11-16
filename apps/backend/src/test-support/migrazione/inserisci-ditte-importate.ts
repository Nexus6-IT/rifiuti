/**
 * Solo per i test (Fase 3, 3.1, Task 9): un `inserisciBlocco` per `ditte`, con SQL PARAMETRIZZATO e
 * `ON CONFLICT` sul bersaglio nominato della chiave legacy. Mostra il pattern che useranno movimenti
 * e FIR: ogni valore e' un parametro, il conflitto e' solo quello della chiave, `RETURNING id` dice
 * quante righe sono davvero entrate.
 */
import type {
  ContestoBlocco,
  InserisciBlocco,
  Tx,
} from '../../application/migrazione/caricamento/tipi'

export interface RigaDittaImportata {
  legacyKey: string
  ragioneSociale: string
  partitaIva: string | null
  /** Solo per provare la RLS: scrive su un'altra azienda. */
  tenantIdForzato?: string
}

export const inserisciDitteImportate: InserisciBlocco<RigaDittaImportata> = async (
  tx: Tx,
  righe: readonly RigaDittaImportata[],
  contesto: ContestoBlocco
): Promise<number> => {
  let inserite = 0
  for (const r of righe) {
    const esito = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "ditte"
        ("tenant_id", "ragione_sociale", "partita_iva", "import_source", "legacy_key", "lotto_import_id", "updated_at")
      VALUES
        (${r.tenantIdForzato ?? contesto.tenantId}::uuid, ${r.ragioneSociale}, ${r.partitaIva},
         'WINWASTE', ${r.legacyKey}, ${contesto.lottoId}::uuid, now())
      ON CONFLICT ("tenant_id", "import_source", "legacy_key") WHERE "import_source" IS NOT NULL
      DO NOTHING
      RETURNING "id"`
    inserite += esito.length
  }
  return inserite
}
