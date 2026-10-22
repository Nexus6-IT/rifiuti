/**
 * TenantSwitchInterceptor — Test anti-leak e di scoping multi-tenant (WS-A)
 *
 * Scenari critici di sicurezza verificati:
 *   1. Utente normale senza header → usa tenant primario (no-op).
 *   2. SUPER_ADMIN con header → passthrough (già gestito dal middleware).
 *   3. Utente con header X-Tenant-ID di un tenant DI CUI È MEMBRO → switch corretto.
 *   4. Utente con header X-Tenant-ID di un tenant NON SUO → 403
 *      AZIENDA_SELEZIONATA_NON_ACCESSIBILE, l'handler non gira (niente ripiego sul primario,
 *      che scriverebbe nell'azienda sbagliata).
 *   5. Errore DB nella verifica → stesso 403.
 *   7. Rotta di recupero (@ConsentiSelezioneNonValida) → prosegue col tenant primario.
 *   6. Header pari al tenant primario → autorizzato senza query DB (ottimizzazione).
 */

import { ExecutionContext, CallHandler, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { lastValueFrom, of } from 'rxjs'
import { TenantSwitchInterceptor } from './tenant-switch.interceptor'
import { MembershipService } from '../../api/me/membership.service'
import { TenantContext } from '../context/tenant-context'
import { ConsentiSelezioneNonValida } from '../decorators/consenti-selezione-non-valida.decorator'

/** Risposta attesa per un'azienda selezionata non accessibile (inesistente o non autorizzata). */
const RIFIUTO_ATTESO = {
  message: "L'azienda selezionata non è più accessibile: selezionane un'altra.",
  error: 'AZIENDA_SELEZIONATA_NON_ACCESSIBILE',
}

/** Rotte finte: una qualunque e una di recupero (elenco/switch delle aziende). */
class RotteFinte {
  qualunque() {}
  @ConsentiSelezioneNonValida()
  recupero() {}
}

const TENANT_A = 'tenant-A-primario-uuid'
const TENANT_B = 'tenant-B-autorizzato-uuid'
const TENANT_C = 'tenant-C-non-autorizzato-uuid'

const USER_NORMALE = {
  id: 'user-normale-uuid',
  role: 'OPERATOR',
  tenantId: TENANT_A,
}

const USER_SUPER_ADMIN = {
  id: 'super-admin-uuid',
  role: 'SUPER_ADMIN',
  tenantId: '',
}

/** Costruisce un mock di ExecutionContext HTTP con i dati della request. */
function makeContext(
  headerTenantId: string | undefined,
  user: object | null,
  reqTenantId?: string,
  handler: () => void = RotteFinte.prototype.qualunque
): ExecutionContext {
  const req: any = {
    headers: {},
    user,
    tenantId: reqTenantId ?? (user as any)?.tenantId ?? '',
  }
  if (headerTenantId !== undefined) {
    req.headers['x-tenant-id'] = headerTenantId
  }

  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => RotteFinte,
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext
}

/** Costruisce un CallHandler che emette un valore di risposta "segnale". */
function makeHandler(responseValue = 'RISPOSTA_ORIGINALE'): CallHandler {
  return { handle: () => of(responseValue) }
}

/** Helper: esegue l'interceptor e restituisce il valore emesso dall'Observable. */
async function runInterceptor(
  interceptor: TenantSwitchInterceptor,
  ctx: ExecutionContext,
  handler: CallHandler
): Promise<unknown> {
  const obs = interceptor.intercept(ctx, handler)
  return lastValueFrom(obs)
}

describe('TenantSwitchInterceptor', () => {
  let membershipMock: jest.Mocked<MembershipService>
  let interceptor: TenantSwitchInterceptor

  beforeEach(() => {
    membershipMock = {
      checkAccess: jest.fn(),
      listTenants: jest.fn(),
      switchTenant: jest.fn(),
    } as unknown as jest.Mocked<MembershipService>

    interceptor = new TenantSwitchInterceptor(membershipMock, new Reflector())
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1: Nessun header → passthrough
  // ──────────────────────────────────────────────────────────────────────────
  it('senza header X-Tenant-ID passa al handler senza modifiche', async () => {
    const ctx = makeContext(undefined, USER_NORMALE, TENANT_A)
    const handler = makeHandler()

    const result = await runInterceptor(interceptor, ctx, handler)

    expect(result).toBe('RISPOSTA_ORIGINALE')
    expect(membershipMock.checkAccess).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2: SUPER_ADMIN → passthrough (middleware già gestisce)
  // ──────────────────────────────────────────────────────────────────────────
  it('SUPER_ADMIN con header → passthrough (non tocca la membership)', async () => {
    const ctx = makeContext(TENANT_B, USER_SUPER_ADMIN, '')
    const handler = makeHandler()

    const result = await runInterceptor(interceptor, ctx, handler)

    expect(result).toBe('RISPOSTA_ORIGINALE')
    expect(membershipMock.checkAccess).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3: Header = tenant primario → autorizzato senza query DB
  // ──────────────────────────────────────────────────────────────────────────
  it('header uguale al tenant primario → autorizzato (checkAccess restituisce true senza query aggiuntive)', async () => {
    membershipMock.checkAccess.mockResolvedValue(true)
    const ctx = makeContext(TENANT_A, USER_NORMALE, TENANT_A)
    let tenantInContesto: string | null = null

    const handler: CallHandler = {
      handle: () => {
        // Cattura il tenant attivo nel contesto al momento dell'esecuzione.
        tenantInContesto = TenantContext.getTenantId()
        return of('OK')
      },
    }

    await runInterceptor(interceptor, ctx, handler)

    // Il metodo checkAccess viene chiamato: il tenant primario è uguale → true immediato.
    // Il TenantContext viene sovrascritto con TENANT_A (che era già quello corretto).
    expect(tenantInContesto).toBe(TENANT_A)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4 (CRITICO ANTI-LEAK): header di tenant NON autorizzato → fail-closed
  // ──────────────────────────────────────────────────────────────────────────
  it('ANTI-LEAK: header X-Tenant-ID di tenant non autorizzato → 403, handler non eseguito, req.tenantId invariato', async () => {
    membershipMock.checkAccess.mockResolvedValue(false)
    const ctx = makeContext(TENANT_C, USER_NORMALE, TENANT_A)
    const reqObj = ctx.switchToHttp().getRequest() as any
    const handle = jest.fn(() => of('OK'))

    const errore: any = await runInterceptor(interceptor, ctx, { handle }).catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse()).toEqual(RIFIUTO_ATTESO)
    // Niente ripiego sul tenant primario: l'handler non deve girare affatto.
    expect(handle).not.toHaveBeenCalled()
    expect(reqObj.tenantId).toBe(TENANT_A)
    expect(membershipMock.checkAccess).toHaveBeenCalledWith(USER_NORMALE.id, TENANT_C, TENANT_A)
  })

  it('azienda inesistente e azienda non autorizzata danno la stessa risposta (nessuna enumerazione)', async () => {
    // checkAccess restituisce false in entrambi i casi; la risposta non deve distinguerli.
    membershipMock.checkAccess.mockResolvedValue(false)
    const nonAutorizzata: any = await runInterceptor(
      interceptor,
      makeContext(TENANT_C, USER_NORMALE, TENANT_A),
      makeHandler()
    ).catch(e => e)
    const inesistente: any = await runInterceptor(
      interceptor,
      makeContext('tenant-che-non-esiste', USER_NORMALE, TENANT_A),
      makeHandler()
    ).catch(e => e)

    expect(inesistente.getStatus()).toBe(403)
    expect(inesistente.getResponse()).toEqual(nonAutorizzata.getResponse())
  })

  it('rotta di recupero (@ConsentiSelezioneNonValida) con header non accessibile → prosegue col tenant primario', async () => {
    membershipMock.checkAccess.mockResolvedValue(false)
    const ctx = makeContext(TENANT_C, USER_NORMALE, TENANT_A, RotteFinte.prototype.recupero)
    const reqObj = ctx.switchToHttp().getRequest() as any
    let tenantInContesto: string | null = null

    await TenantContext.run({ tenantId: TENANT_A }, async () => {
      const result = await runInterceptor(interceptor, ctx, {
        handle: () => {
          tenantInContesto = TenantContext.getTenantId()
          return of('ELENCO_AZIENDE')
        },
      })
      expect(result).toBe('ELENCO_AZIENDE')
    })

    expect(tenantInContesto).toBe(TENANT_A)
    expect(reqObj.tenantId).toBe(TENANT_A)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5: utente membro del tenant B → switch autorizzato
  // ──────────────────────────────────────────────────────────────────────────
  it('header X-Tenant-ID di tenant autorizzato → TenantContext sovrascritto con tenant B', async () => {
    membershipMock.checkAccess.mockResolvedValue(true)
    const ctx = makeContext(TENANT_B, USER_NORMALE, TENANT_A)
    const reqObj = ctx.switchToHttp().getRequest() as any
    let tenantInContesto: string | null = null

    const handler: CallHandler = {
      handle: () => {
        tenantInContesto = TenantContext.getTenantId()
        return of('DATI_TENANT_B')
      },
    }

    // Avvolgiamo con il contesto del middleware (TENANT_A).
    await TenantContext.run({ tenantId: TENANT_A }, async () => {
      const result = await runInterceptor(interceptor, ctx, handler)
      expect(result).toBe('DATI_TENANT_B')
    })

    // Il TenantContext durante l'esecuzione dell'handler deve essere TENANT_B.
    expect(tenantInContesto).toBe(TENANT_B)
    // req.tenantId deve essere aggiornato a TENANT_B.
    expect(reqObj.tenantId).toBe(TENANT_B)
    expect(membershipMock.checkAccess).toHaveBeenCalledWith(USER_NORMALE.id, TENANT_B, TENANT_A)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 6: errore DB → fail-closed (non espone l'errore al client)
  // ──────────────────────────────────────────────────────────────────────────
  it('errore DB nella verifica → 403 AZIENDA_SELEZIONATA_NON_ACCESSIBILE, handler non eseguito', async () => {
    membershipMock.checkAccess.mockRejectedValue(new Error('DB connection lost'))
    const ctx = makeContext(TENANT_B, USER_NORMALE, TENANT_A)
    const handle = jest.fn(() => of('OK'))

    const errore: any = await runInterceptor(interceptor, ctx, { handle }).catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    // Il messaggio dell'errore interno non arriva al client.
    expect(errore.getResponse()).toEqual(RIFIUTO_ATTESO)
    expect(handle).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 7: utente non autenticato (rotta pubblica con header) → passthrough
  // ──────────────────────────────────────────────────────────────────────────
  it('utente non autenticato con header → passthrough senza verifica', async () => {
    const ctx = makeContext(TENANT_B, null)
    const handler = makeHandler()

    const result = await runInterceptor(interceptor, ctx, handler)

    expect(result).toBe('RISPOSTA_ORIGINALE')
    expect(membershipMock.checkAccess).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 8: contesto non HTTP (es. WebSocket/gRPC) → passthrough
  // ──────────────────────────────────────────────────────────────────────────
  it('contesto non HTTP → passthrough senza verifica', async () => {
    const nonHttpCtx = {
      getType: () => 'ws',
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext
    const handler = makeHandler()

    const result = await runInterceptor(interceptor, nonHttpCtx, handler)

    expect(result).toBe('RISPOSTA_ORIGINALE')
    expect(membershipMock.checkAccess).not.toHaveBeenCalled()
  })
})
