import { Prisma } from '@prisma/client'
import { HASH_VERSIONE_CORRENTE } from '../../domain/waste-movement/waste-movement.entity'

/**
 * Numerazione di un'annotazione del registro, condivisa dalla registrazione ordinaria e dalle
 * correzioni (rettifica e annullamento): stesso lock, stesso progressivo, stessa catena di hash.
 * Estratta da `RegistraMovimentoUseCase` senza cambiarne il comportamento.
 */

/**
 * Lock del progressivo `<registro>-<anno>`: serializza le numerazioni dello stesso registro e
 * anno in transazioni concorrenti senza FOR UPDATE su aggregati (PostgreSQL 0A000: "FOR UPDATE is
 * not allowed with aggregate functions"). `pg_advisory_xact_lock` si rilascia da solo a
 * commit/rollback. Secondo lock dell'ordine fisso (FIR, progressivo, giacenza).
 */
export async function bloccaProgressivo(
  tx: Prisma.TransactionClient,
  registroId: string,
  anno: number
): Promise<void> {
  const lockKey = `${registroId}-${anno}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
}

export interface NumerazioneAnnotazione {
  /** Progressivo da assegnare: successivo all'ultimo dell'anno, mai sotto il progressivo iniziale. */
  progressivo: number
  /** `entry_hash` salvato dell'ultima annotazione del registro e anno ('' se e' la prima). */
  hashPrecedente: string
}

/**
 * Progressivo e hash precedente, da leggere SOTTO il lock del progressivo (`bloccaProgressivo`).
 * L'ultima annotazione (progressivo piu' alto) col suo hash si leggono insieme: l'hash v2 si
 * concatena a quello (R8). Il progressivo iniziale (C-W-02) fa proseguire la numerazione gia'
 * trasmessa di chi arriva da un altro programma a meta' anno; e' letto sotto lo stesso lock con
 * cui `ProgressivoInizialeService` lo imposta, quindi non c'e' corsa fra i due.
 */
export async function numeraAnnotazione(
  tx: Prisma.TransactionClient,
  registroId: string,
  anno: number
): Promise<NumerazioneAnnotazione> {
  const [ultima] = await tx.$queryRaw<Array<{ max_num: number; entry_hash: string }>>`
    SELECT progressive_number AS max_num, entry_hash
    FROM waste_movements
    WHERE registro_id = ${registroId}::uuid
      AND progressive_year = ${anno}
    ORDER BY progressive_number DESC
    LIMIT 1
  `
  const iniziale = await tx.registroProgressivoIniziale.findUnique({
    where: { registroId_anno: { registroId, anno } },
    select: { primoProgressivo: true },
  })
  return {
    progressivo: Math.max((ultima?.max_num ?? 0) + 1, iniziale?.primoProgressivo ?? 1),
    hashPrecedente: ultima?.entry_hash ?? '',
  }
}

/** Inserisce l'annotazione con la versione corrente dell'hash. Mai UPDATE ne' DELETE (R13). */
export async function inserisciAnnotazione(
  tx: Prisma.TransactionClient,
  dati: Prisma.WasteMovementUncheckedCreateInput
) {
  return tx.wasteMovement.create({ data: { ...dati, hashVersione: HASH_VERSIONE_CORRENTE } })
}
