import { TenantContext } from '../../core/context/tenant-context'

/**
 * Esegue `fn` nel contesto dell'azienda richiesta: lo apre se manca, rifiuta se ne esiste uno
 * di un'altra azienda (stesso comportamento di `SoglieDepositoService`).
 */
export function nelContestoTenant<R>(tenantId: string, fn: () => Promise<R>): Promise<R> {
  const corrente = TenantContext.getStoreTenantId()
  if (corrente === null) return TenantContext.run({ tenantId }, fn)
  if (corrente !== tenantId) {
    return Promise.reject(
      new Error('Servizi pese: il tenant richiesto non coincide con quello del contesto.')
    )
  }
  return fn()
}
