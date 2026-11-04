// Lock del legame movimento-cliente-prezzo (fase 4.3, spec §5). L'ordine, mai invertito:
//
//   1. lock del registro (advisory di progressivo e giacenza)
//   2. lock consultivo del legame per radice (`bloccaLegamePerRadice`)
//   2b. (solo chi scrive il legame: `proponiEScrivi`) riga di `impostazioni_fatturazione` FOR SHARE;
//       chi la tiene FOR UPDATE (`imposta`) non prende altri lock, quindi nessun ciclo
//   3. contratto FOR SHARE            \
//   4. elenchi FOR SHARE per id        > `bloccaListinoInCondivisione`
//   5. righe di listino FOR SHARE per id /
//   6. testate e righe del legame FOR UPDATE per id (`bloccaRigheLegame`)
//
// Il lock consultivo `listino-contratto` NON si prende (serve solo a codici e predefinito) e i
// servizi del listino non prendono mai lock del registro o del legame: non c'e' ciclo possibile.
//
// Perche' FOR SHARE sul listino: il listino lo scrive con FOR UPDATE (elenchi) e FOR NO KEY UPDATE
// (righe), che confliggono con FOR SHARE, quindi una modifica del listino e una conferma si
// serializzano (la conferma non copia mai un valore a meta' modifica). Due legami fra loro NON si
// bloccano: FOR SHARE non confligge con FOR SHARE.
//
// Registro: e' append-only e non prende mai lock di riga sui movimenti (solo advisory e, per le
// FK dell'annotazione, FOR KEY SHARE sul predecessore e sulla radice). L'INSERT di un legame
// prende a sua volta FOR KEY SHARE sul movimento (originale e vigente): KEY SHARE non confligge con
// KEY SHARE, quindi non esiste un ordine di lock fra registro e legame che possa dare un ciclo.
//
// Rischi residui accettati (409 `OPERAZIONE_CONCORRENTE`, nessun dato incoerente):
// - `codici_iva`: l'INSERT di una riga del legame prende KEY SHARE sul codice IVA (FK) senza
//   bloccarlo. Va bene perche' l'IVA del legame si copia sempre dalla riga di listino (decisione
//   16), che qui e' bloccata FOR SHARE e cita lo stesso codice: un DELETE concorrente non riesce.
//   Se un giorno l'IVA di una riga potesse differire da quella del listino, aggiungere
//   `codici_iva FOR SHARE` al passo 5.
// - cliente: un legame con `cliente_id` e' protetto solo dalla FK; un DELETE concorrente del
//   cliente puo' far uscire 23503 sull'INSERT/UPDATE del legame (da tradurre in 409 nei servizi).
import { NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  bloccaContrattoListino,
  joinLineari,
  type ContrattoBloccato,
} from '../listino/lock-listino'

/**
 * Tetto di attesa del lock consultivo nell'aggancio alla registrazione: oltre, il legame rinuncia
 * (55P03) e il registro prosegue senza (mai bloccare il registro per un problema commerciale).
 */
export const LOCK_TIMEOUT_AGGANCIO = '2s'

/** Per le transazioni di aggancio: tetto di attesa piu' corto di quello delle scritture del listino. */
export async function impostaTimeoutAggancio(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_AGGANCIO}'`)
}

/** Id distinti e in ordine: le liste dei chiamanti possono avere doppioni e ordine qualunque. */
function ordinati(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort()
}

/** Lock consultivo per radice della catena (spazio di chiavi `legame-movimento`), fino a fine transazione. */
export async function bloccaLegamePerRadice(
  tx: Prisma.TransactionClient,
  radiceId: string
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('legame-movimento'), hashtext(${radiceId}))`
}

/**
 * Contratto FOR SHARE (`bloccaContrattoListino`: 404 se manca, 409 se annullato), poi gli elenchi
 * indicati FOR SHARE in ordine di id, poi le righe di listino indicate FOR SHARE in ordine di id.
 * Elenchi e righe che non esistono (o che non sono del contratto) danno 404
 * `ELENCO_ADDEBITI_NON_TROVATO` / `RIGA_ADDEBITO_NON_TROVATA`: sono spariti o cambiati fra la
 * lettura e il lock, e la conferma deve ripartire dalla lettura.
 */
export async function bloccaListinoInCondivisione(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contrattoId: string,
  elencoIds: readonly string[],
  rigaIds: readonly string[]
): Promise<ContrattoBloccato> {
  const contratto = await bloccaContrattoListino(tx, tenantId, contrattoId)
  const elenchi = ordinati(elencoIds)
  const righe = ordinati(rigaIds)
  if (elenchi.length > 0 || righe.length > 0) await joinLineari(tx)

  if (elenchi.length > 0) {
    const bloccati = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id::text AS id FROM elenchi_addebiti e
      JOIN unnest(${elenchi}::uuid[]) AS chiesti(chiesto) ON chiesto = e.id
      WHERE e.tenant_id = ${tenantId}::uuid AND e.contratto_id = ${contrattoId}::uuid
      ORDER BY e.id FOR SHARE OF e`
    if (bloccati.length !== elenchi.length) {
      throw new NotFoundException({
        message: 'Elenco di addebiti non trovato.',
        error: 'ELENCO_ADDEBITI_NON_TROVATO',
      })
    }
  }
  if (righe.length > 0) {
    const bloccate = await tx.$queryRaw<{ id: string; elencoId: string }[]>`
      SELECT r.id::text AS id, r.elenco_id::text AS "elencoId" FROM righe_addebito r
      JOIN unnest(${righe}::uuid[]) AS chiesti(chiesto) ON chiesto = r.id
      WHERE r.tenant_id = ${tenantId}::uuid
      ORDER BY r.id FOR SHARE OF r`
    // Una riga di un elenco non bloccato (altro contratto o elenco non indicato) vale come
    // «non trovata»: altrimenti la fermerebbe solo piu' tardi una FK (23503 invece del 404).
    const elenchiAttesi = new Set(elenchi)
    const fuoriElenco = elenchi.length > 0 && bloccate.some(r => !elenchiAttesi.has(r.elencoId))
    if (bloccate.length !== righe.length || fuoriElenco) {
      throw new NotFoundException({
        message: 'Riga di listino non trovata.',
        error: 'RIGA_ADDEBITO_NON_TROVATA',
      })
    }
  }
  return contratto
}

/**
 * Testate dei legami FOR UPDATE in ordine di id, poi le loro righe FOR UPDATE in ordine di id.
 * Id inesistenti o di altre aziende sono ignorati: sono i chiamanti a controllare cosa hanno
 * trovato (sono liste di azioni di massa, tetto 500, e un legame puo' sparire fra due letture).
 */
export async function bloccaRigheLegame(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legameIds: readonly string[]
): Promise<void> {
  const ids = ordinati(legameIds)
  if (ids.length === 0) return
  await joinLineari(tx)
  await tx.$queryRaw`
    SELECT l.id::text AS id FROM legami_movimento l
    JOIN unnest(${ids}::uuid[]) AS chiesti(chiesto) ON chiesto = l.id
    WHERE l.tenant_id = ${tenantId}::uuid
    ORDER BY l.id FOR UPDATE OF l`
  await tx.$queryRaw`
    SELECT r.id::text AS id FROM righe_legame_movimento r
    JOIN unnest(${ids}::uuid[]) AS chiesti(chiesto) ON chiesto = r.legame_id
    WHERE r.tenant_id = ${tenantId}::uuid
    ORDER BY r.id FOR UPDATE OF r`
}
