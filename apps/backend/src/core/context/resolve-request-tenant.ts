/**
 * Tenant (azienda) EFFETTIVO su cui la richiesta corrente sta operando.
 *
 * Esiste una sola risposta valida a "su quale azienda sto scrivendo?", e questa
 * funzione è il punto unico che la dà. Ordine di risoluzione:
 *
 *   1. `req.tenantId` — depositato dal `TenantContextMiddleware` (dal JWT) e
 *      sovrascritto dal `TenantSwitchInterceptor` DOPO aver validato l'header
 *      `X-Tenant-ID` contro la membership dell'utente. È lo stesso valore che
 *      finisce nel `TenantContext` e quindi nell'estensione RLS di Prisma.
 *   2. `req.user.tenantId` — tenant primario del JWT. Fallback per i contesti
 *      che non passano dal middleware (alcuni test, rotte montate a parte).
 *
 * PERCHÉ NON BASTA `req.user.tenantId`: lo switch di azienda non riscrive il
 * token, quindi `user.tenantId` resta il tenant primario. Usarlo nei controller
 * mentre i repository RLS usano `req.tenantId` significa leggere le anagrafiche
 * dall'azienda B e scrivere il record nell'azienda A.
 */
import { ForbiddenException } from '@nestjs/common'

export function resolveRequestTenantId(request: unknown): string | null {
  const req = (request ?? {}) as { tenantId?: unknown; user?: { tenantId?: unknown } }

  const selezionato = typeof req.tenantId === 'string' ? req.tenantId.trim() : ''
  if (selezionato.length > 0) {
    return selezionato
  }

  const dalToken = typeof req.user?.tenantId === 'string' ? req.user.tenantId.trim() : ''
  return dalToken.length > 0 ? dalToken : null
}

/**
 * Come `resolveRequestTenantId`, ma FAIL-CLOSED: se l'azienda non è
 * determinabile la richiesta viene rifiutata invece di proseguire senza
 * perimetro. È la variante da usare nei controller — un handler che opera
 * "senza azienda" finirebbe per leggere o scrivere fuori dal proprio tenant.
 *
 * Caso tipico: SUPER_ADMIN in contesto globale (nessun `X-Tenant-ID`
 * selezionato) su un endpoint che è per definizione di una singola azienda.
 */
export function requireRequestTenantId(request: unknown): string {
  const tenantId = resolveRequestTenantId(request)
  if (!tenantId) {
    throw new ForbiddenException(
      'Nessuna azienda selezionata per questa richiesta: selezionane una prima di procedere.'
    )
  }
  return tenantId
}
