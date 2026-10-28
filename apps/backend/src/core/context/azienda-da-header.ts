import { isUUID } from 'class-validator'

/**
 * Azienda "candidata" di una richiesta: quella indicata dall'header `X-Tenant-ID` quando è
 * diversa dall'azienda di casa dell'utente.
 *
 * Serve ai guard (`RolesGuard`, `PermissionGuard`), che girano PRIMA del
 * `TenantSwitchInterceptor` globale e quindi non vedono ancora l'azienda selezionata:
 * con un'azienda candidata decidono sul ruolo/permessi dell'utente in QUELL'azienda e non su
 * quelli del token (azienda di casa).
 *
 * Restituisce l'UUID dell'header solo se: l'header è presente (array → primo valore, trim),
 * è un UUID valido, l'utente non è SUPER_ADMIN (il middleware onora già l'header) ed è
 * diverso da `user.tenantId` (confronto senza distinzione di maiuscole). Il valore restituito
 * e' in minuscolo. Altrimenti `null`: nessun cambiamento rispetto al token.
 */
export function aziendaCandidataDaHeader(req: {
  headers?: Record<string, string | string[] | undefined>
  user?: { role?: string; tenantId?: string | null } | null
}): string | null {
  const utente = req?.user
  if (!utente || utente.role === 'SUPER_ADMIN') return null

  const raw = req.headers?.['x-tenant-id']
  const valore = Array.isArray(raw) ? raw[0] : raw
  const candidata = typeof valore === 'string' ? valore.trim().toLowerCase() : ''
  if (candidata.length === 0 || !isUUID(candidata, 'all')) return null
  if (candidata === utente.tenantId?.toLowerCase()) return null
  return candidata
}
