// Lock del legame movimento-cliente-prezzo (fase 4.3, spec §5). L'ordine, mai invertito:
//
//   1. lock del registro (progressivo, giacenza) e righe del movimento (`bloccaMovimentiPerLegame`)
//   2. lock consultivo del legame per radice (`bloccaLegamePerRadice`)
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
// Effetto dell'INSERT di un legame (Task 3): le FK composite verso `waste_movements` prendono
// FOR KEY SHARE sul movimento (originale e vigente). Confligge solo con FOR UPDATE / cancellazione /
// cambio di chiave del movimento, che il registro fa PRIMA di prendere il lock consultivo. Una
// transazione che inserisce un legame senza avere gia' il lock del registro (lista «da collegare»,
// azioni di massa) deve quindi prendere i movimenti con `bloccaMovimentiPerLegame` PRIMA del lock
// consultivo, altrimenti tiene il lock consultivo e aspetta il movimento che il registro tiene
// mentre aspetta il lock consultivo: deadlock. Prese in quest'ordine non si incrociano.
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

/**
 * Movimenti FOR KEY SHARE, in ordine di id: lo stesso lock che l'INSERT del legame prende per le FK.
 * Da chiamare prima di `bloccaLegamePerRadice` se la transazione non ha gia' il lock del registro.
 * Non scrive nulla sul registro (e' solo un lock).
 */
export async function bloccaMovimentiPerLegame(
  tx: Prisma.TransactionClient,
  tenantId: string,
  movimentoIds: readonly string[]
): Promise<void> {
  const ids = ordinati(movimentoIds)
  if (ids.length === 0) return
  await joinLineari(tx)
  await tx.$queryRaw`
    SELECT m.id::text AS id FROM waste_movements m
    JOIN unnest(${ids}::uuid[]) AS chiesti(chiesto) ON chiesto = m.id
    WHERE m.tenant_id = ${tenantId}::uuid
    ORDER BY m.id FOR KEY SHARE OF m`
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
    const bloccate = await tx.$queryRaw<{ id: string }[]>`
      SELECT r.id::text AS id FROM righe_addebito r
      JOIN unnest(${righe}::uuid[]) AS chiesti(chiesto) ON chiesto = r.id
      WHERE r.tenant_id = ${tenantId}::uuid
      ORDER BY r.id FOR SHARE OF r`
    if (bloccate.length !== righe.length) {
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
