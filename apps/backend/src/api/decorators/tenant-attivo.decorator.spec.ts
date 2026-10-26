/**
 * I decorator che i controller usano per sapere "su quale azienda sto operando"
 * devono restituire il tenant EFFETTIVO della richiesta (quello selezionato e
 * già validato), non il tenant primario del JWT.
 *
 * Scenario coperto: SUPER_ADMIN che impersona l'azienda B via `X-Tenant-ID`.
 * Prima del fix `@CurrentTenant` e `@CurrentUser().tenantId` restituivano
 * l'azienda A (quella del token) mentre i repository RLS leggevano/scrivevano
 * su B: i FIR creati finivano nell'azienda sbagliata.
 */

import 'reflect-metadata'
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { ForbiddenException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { TenantId } from '../../core/decorators/tenant.decorator'
import { CurrentUser as CurrentUserVecchioPercorso } from './current-user.decorator'
import { CurrentTenant } from './current-tenant.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'

const TENANT_PRIMARIO = 'tenant-A-uuid'
const TENANT_IMPERSONATO = 'tenant-B-uuid'

/** Estrae la factory di un param decorator per poterla invocare nei test. */
function factoryOf(decorator: (...args: any[]) => ParameterDecorator) {
  class Sonda {
    // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
    metodo(@decorator() _valore: unknown) {}
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Sonda, 'metodo')
  return metadata[Object.keys(metadata)[0]].factory as (data: unknown, ctx: ExecutionContext) => any
}

function contestoConSwitch(): ExecutionContext {
  const req = {
    // Impostato dal TenantContextMiddleware / TenantSwitchInterceptor dopo aver
    // VALIDATO l'header X-Tenant-ID.
    tenantId: TENANT_IMPERSONATO,
    // Resta il tenant del JWT: non viene riscritto dallo switch.
    user: {
      id: 'super-admin-uuid',
      email: 'admin@example.it',
      tenantId: TENANT_PRIMARIO,
      role: 'SUPER_ADMIN',
      permissions: [],
    },
  }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}

describe('decorator del tenant attivo', () => {
  it('@CurrentTenant restituisce l’azienda selezionata, non quella del JWT', () => {
    const tenantId = factoryOf(CurrentTenant)(undefined, contestoConSwitch())

    expect(tenantId).toBe(TENANT_IMPERSONATO)
  })

  it('@CurrentUser espone il tenant dell’azienda selezionata', () => {
    const user = factoryOf(CurrentUser)(undefined, contestoConSwitch())

    expect(user.tenantId).toBe(TENANT_IMPERSONATO)
    // L'identità dell'utente resta la sua: cambia solo l'azienda su cui opera.
    expect(user.id).toBe('super-admin-uuid')
    expect(user.role).toBe('SUPER_ADMIN')
  })
})

describe('@TenantId (core/decorators): azienda selezionata, fail-closed', () => {
  const ctx = (req: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext

  it('token A, azienda selezionata B: restituisce B', () => {
    const req = { tenantId: 'B', user: { tenantId: 'A' }, headers: {} }
    expect(factoryOf(TenantId)(undefined, ctx(req))).toBe('B')
  })

  it('senza azienda selezionata ripiega sul token (stessa regola di @CurrentTenant)', () => {
    expect(factoryOf(TenantId)(undefined, ctx({ user: { tenantId: 'A' }, headers: {} }))).toBe('A')
  })

  it('nessuna azienda: 403, mai undefined', () => {
    expect(() => factoryOf(TenantId)(undefined, ctx({ user: {}, headers: {} }))).toThrow(
      ForbiddenException
    )
  })

  it("l'header x-tenant-id grezzo (non validato) NON viene usato", () => {
    const req = { user: {}, headers: { 'x-tenant-id': 'ALTRUI' } }
    expect(() => factoryOf(TenantId)(undefined, ctx(req))).toThrow(ForbiddenException)
    const conToken = { user: { tenantId: 'A' }, headers: { 'x-tenant-id': 'ALTRUI' } }
    expect(factoryOf(TenantId)(undefined, ctx(conToken))).toBe('A')
  })
})

describe('@CurrentUser nei controller dei permessi (api/decorators = auth/decorators)', () => {
  it('il vecchio percorso esporta lo stesso decoratore', () => {
    expect(CurrentUserVecchioPercorso).toBe(CurrentUser)
  })

  it("@CurrentUser('id') restituisce il campo, non l'intero utente", () => {
    expect(factoryOf(CurrentUser)('id', contestoConSwitch())).toBe('super-admin-uuid')
  })

  it("@CurrentUser('tenantId') segue l'azienda selezionata", () => {
    expect(factoryOf(CurrentUser)('tenantId', contestoConSwitch())).toBe(TENANT_IMPERSONATO)
  })
})
