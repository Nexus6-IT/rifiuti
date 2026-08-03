/**
 * Risoluzione del tenant EFFETTIVO della richiesta.
 *
 * Regola di prodotto: ogni sviluppo è isolato per tenant/azienda. Il tenant su
 * cui la richiesta opera deve essere UNO SOLO: quello selezionato (validato dal
 * `TenantSwitchInterceptor`/middleware e depositato su `req.tenantId`), non il
 * tenant primario del JWT. Con due fonti divergenti un SUPER_ADMIN che sta
 * impersonando l'azienda B scriverebbe nell'azienda A.
 */

import { ForbiddenException } from '@nestjs/common'
import { resolveRequestTenantId, requireRequestTenantId } from './resolve-request-tenant'

const TENANT_PRIMARIO = 'tenant-A-uuid'
const TENANT_SELEZIONATO = 'tenant-B-uuid'

describe('resolveRequestTenantId', () => {
  it('usa il tenant selezionato quando diverge da quello del JWT', () => {
    const req = {
      tenantId: TENANT_SELEZIONATO,
      user: { id: 'u1', tenantId: TENANT_PRIMARIO },
    }

    expect(resolveRequestTenantId(req)).toBe(TENANT_SELEZIONATO)
  })

  it('ricade sul tenant del JWT quando nessun tenant è stato selezionato', () => {
    const req = { user: { id: 'u1', tenantId: TENANT_PRIMARIO } }

    expect(resolveRequestTenantId(req)).toBe(TENANT_PRIMARIO)
  })

  it('ignora un tenant selezionato vuoto (super admin in contesto globale)', () => {
    const req = { tenantId: '', user: { id: 'u1', tenantId: TENANT_PRIMARIO } }

    expect(resolveRequestTenantId(req)).toBe(TENANT_PRIMARIO)
  })

  it('ritorna null quando non c’è alcun tenant nella richiesta', () => {
    expect(resolveRequestTenantId({ user: { id: 'u1' } })).toBeNull()
    expect(resolveRequestTenantId({})).toBeNull()
  })
})

describe('requireRequestTenantId', () => {
  it('restituisce il tenant effettivo quando è determinabile', () => {
    const req = { tenantId: TENANT_SELEZIONATO, user: { tenantId: TENANT_PRIMARIO } }

    expect(requireRequestTenantId(req)).toBe(TENANT_SELEZIONATO)
  })

  it('rifiuta la richiesta se nessuna azienda è determinabile (fail-closed)', () => {
    // Senza azienda l'alternativa sarebbe operare su un tenant arbitrario:
    // meglio negare l'operazione che scriverla nell'azienda sbagliata.
    expect(() => requireRequestTenantId({ user: { id: 'u1' } })).toThrow(ForbiddenException)
  })
})
