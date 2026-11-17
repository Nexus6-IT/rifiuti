/**
 * Fase 3 (3.1), D3: frammento SQL «nessun antenato (o il movimento stesso) e' un importato non
 * riconciliato». Serve all'adozione automatica e allo storico: una correzione (RETTIFICA o
 * ANNULLAMENTO) la cui catena `movimento_rettificato_id` parte da un movimento importato in stato
 * `DA_RICONCILIARE` NON deve ricevere una riga di coda, neppure se il suo predecessore diretto e'
 * una correzione ordinaria senza riga.
 *
 * Lo si usa nel `WHERE` di una query con il movimento candidato aliasato `m`. `UNION` (non `ALL`)
 * fa terminare la ricorsione anche su un ciclo inatteso; la RLS vale come per ogni SELECT di chi
 * scrive. Si valuta solo per le correzioni (`m.movimento_rettificato_id IS NOT NULL`): le
 * registrazioni ordinarie non pagano la ricorsione.
 */
import { Prisma } from '@prisma/client'

export const NESSUNA_CATENA_DA_RICONCILIARE = Prisma.sql`(
  m."movimento_rettificato_id" IS NULL
  OR NOT EXISTS (
    WITH RECURSIVE "catena"("id", "padre") AS (
      SELECT w."id", w."movimento_rettificato_id"
      FROM "waste_movements" w
      WHERE w."id" = m."id" AND w."tenant_id" = m."tenant_id"
      UNION
      SELECT w."id", w."movimento_rettificato_id"
      FROM "waste_movements" w
      JOIN "catena" c ON w."id" = c."padre" AND w."tenant_id" = m."tenant_id"
    )
    SELECT 1
    FROM "catena" c
    JOIN "movimenti_trasmissione_rentri" cr
      ON cr."movimento_id" = c."id" AND cr."tenant_id" = m."tenant_id"
    WHERE cr."stato" = 'DA_RICONCILIARE'
  )
)`
