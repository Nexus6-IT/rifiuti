// Codici di centro di ricavo e categoria fotografati sulle righe del documento (fase 4.4c, Task
// 30b). Una riga del documento nasce da una riga di listino (`righe_addebito`): i codici sono
// quelli della riga, in mancanza (campo per campo) quelli del suo addebito. Si leggono i CODICI
// (`codifiche_addebito.codice`), non gli id: l'export non deve dipendere dall'anagrafica viva.
import { Prisma } from '@prisma/client'
import { conJoinLineari } from './piani-query'

export interface CodiciRicavo {
  centroRicavoCodice: string | null
  categoriaCodice: string | null
}

/** Oltre questa lunghezza la lista di id passa da `= ANY` a un `JOIN` lineare su `unnest`. */
const SOGLIA_LISTA_LUNGA = 100

/**
 * Codici per le righe di listino indicate, una sola query (nessuna per riga). Una riga senza
 * codici ha i due campi `null`; `get` torna `undefined` solo per un id non trovato. Va chiamata
 * dentro la transazione del chiamante, nel contesto del tenant (RLS).
 */
export async function leggiCodiciRicavo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rigaAddebitoIds: readonly string[]
): Promise<Map<string, CodiciRicavo>> {
  const risultato = new Map<string, CodiciRicavo>()
  const ids = [...new Set(rigaAddebitoIds)]
  if (ids.length === 0) return risultato
  const leggi = () =>
    tx.$queryRaw<
      { id: string; centroRicavoCodice: string | null; categoriaCodice: string | null }[]
    >`
      SELECT ra.id::text AS id,
             COALESCE(cr_riga.codice, cr_add.codice) AS "centroRicavoCodice",
             COALESCE(ca_riga.codice, ca_add.codice) AS "categoriaCodice"
      FROM righe_addebito ra
      JOIN unnest(${ids}::uuid[]) AS chiesti(chiesto) ON chiesto = ra.id
      LEFT JOIN addebiti ad ON ad.id = ra.addebito_id AND ad.tenant_id = ra.tenant_id
      LEFT JOIN codifiche_addebito cr_riga
             ON cr_riga.id = ra.centro_ricavo_id AND cr_riga.tenant_id = ra.tenant_id
      LEFT JOIN codifiche_addebito cr_add
             ON cr_add.id = ad.centro_ricavo_id AND cr_add.tenant_id = ra.tenant_id
      LEFT JOIN codifiche_addebito ca_riga
             ON ca_riga.id = ra.categoria_id AND ca_riga.tenant_id = ra.tenant_id
      LEFT JOIN codifiche_addebito ca_add
             ON ca_add.id = ad.categoria_id AND ca_add.tenant_id = ra.tenant_id
      WHERE ra.tenant_id = ${tenantId}::uuid`
  const righe = ids.length > SOGLIA_LISTA_LUNGA ? await conJoinLineari(tx, leggi) : await leggi()
  for (const r of righe) {
    risultato.set(r.id, {
      centroRicavoCodice: r.centroRicavoCodice,
      categoriaCodice: r.categoriaCodice,
    })
  }
  return risultato
}
