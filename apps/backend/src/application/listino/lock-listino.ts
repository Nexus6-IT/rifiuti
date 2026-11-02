// Lock e tetti di attesa comuni alle scritture del listino (4.2b, R40): contratto FOR SHARE e lock
// consultivo per contratto stanno qui in una sola copia, cosi' l'ordine dei lock non diverge fra
// elenchi, righe e azioni. L'ordine e': contratto FOR SHARE -> lock consultivi -> elenchi FOR UPDATE
// (in ordine di id) -> righe FOR UPDATE (in ordine di id).
import { ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

/** Tetto di attesa di un lock: oltre, la scrittura rinuncia (55P03 -> 409 `OPERAZIONE_CONCORRENTE`). */
export const LOCK_TIMEOUT_SCRITTURA = '10s'

/**
 * Opzioni delle transazioni di scrittura del listino. Il tetto della transazione deve restare sopra
 * `LOCK_TIMEOUT_SCRITTURA`: con il predefinito di Prisma (5 s) scadrebbe prima il tetto della
 * transazione (P2028) e la query bloccata resterebbe sul server.
 */
export const OPZIONI_TRANSAZIONE_SCRITTURA = { timeout: 15_000, maxWait: 5_000 } as const

/** Contratto bloccato FOR SHARE: solo i campi che servono ai servizi del listino. */
export interface ContrattoBloccato {
  id: string
  numero: string
  stato: string
  clienteId: string
  contrattoPrincipaleId: string | null
}

/** Da chiamare come prima istruzione di ogni transazione di scrittura del listino. */
export async function impostaTimeoutLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_SCRITTURA}'`)
}

/**
 * Contratto non eliminato, bloccato FOR SHARE: da qui alla fine nessuno lo annulla o lo elimina.
 * 404 con `CONTRATTO_CLIENTE_NON_TROVATO` se non c'e'; 409 `LISTINO_NON_MODIFICABILE` se annullato
 * (D16).
 */
export async function bloccaContrattoListino(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contrattoId: string
): Promise<ContrattoBloccato> {
  const righe = await tx.$queryRaw<ContrattoBloccato[]>`
    SELECT id::text AS id, numero, stato::text AS stato, cliente_id::text AS "clienteId",
           contratto_principale_id::text AS "contrattoPrincipaleId"
    FROM "contratti_cliente"
    WHERE tenant_id = ${tenantId}::uuid AND id = ${contrattoId}::uuid AND eliminato_il IS NULL
    FOR SHARE`
  if (righe.length === 0) {
    throw new NotFoundException({
      message: 'Contratto non trovato.',
      error: 'CONTRATTO_CLIENTE_NON_TROVATO',
    })
  }
  if (righe[0].stato === 'ANNULLATO') {
    throw new ConflictException({
      error: 'LISTINO_NON_MODIFICABILE',
      message: 'Il listino di un contratto annullato non si modifica.',
    })
  }
  return righe[0]
}

/** Lock consultivo per contratto (spazio di chiavi `listino-contratto`): serializza codici e predefinito. */
export async function lockConsultivoContratto(
  tx: Prisma.TransactionClient,
  contrattoId: string
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('listino-contratto'), hashtext(${contrattoId}))`
}
