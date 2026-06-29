/**
 * TenantSwitchInterceptor — Test anti-leak e di scoping multi-tenant (WS-A)
 *
 * Scenari critici di sicurezza verificati:
 *   1. Utente normale senza header → usa tenant primario (no-op).
 *   2. SUPER_ADMIN con header → passthrough (già gestito dal middleware).
 *   3. Utente con header X-Tenant-ID di un tenant DI CUI È MEMBRO → switch corretto.
 *   4. Utente con header X-Tenant-ID di un tenant NON SUO → fail-closed (anti-leak).
 *   5. Errore DB nella verifica → fail-closed (anti-leak).
 *   6. Header pari al tenant primario → autorizzato senza query DB (ottimizzazione).
 */

import { ExecutionContext, CallHandler } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TenantSwitchInterceptor } from './tenant-switch.interceptor';
import { MembershipService } from '../../api/me/membership.service';
import { TenantContext } from '../context/tenant-context';

const TENANT_A = 'tenant-A-primario-uuid';
const TENANT_B = 'tenant-B-autorizzato-uuid';
const TENANT_C = 'tenant-C-non-autorizzato-uuid';

const USER_NORMALE = {
  id: 'user-normale-uuid',
  role: 'OPERATOR',
  tenantId: TENANT_A,
};

const USER_SUPER_ADMIN = {
  id: 'super-admin-uuid',
  role: 'SUPER_ADMIN',
  tenantId: '',
};

/** Costruisce un mock di ExecutionContext HTTP con i dati della request. */
function makeContext(
  headerTenantId: string | undefined,
  user: object | null,
  reqTenantId?: string,
): ExecutionContext {
  const req: any = {
    headers: {},
    user,
    tenantId: reqTenantId ?? (user as any)?.tenantId ?? '',
  };
  if (headerTenantId !== undefined) {
    req.headers['x-tenant-id'] = headerTenantId;
  }

  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

/** Costruisce un CallHandler che emette un valore di risposta "segnale". */
function makeHandler(responseValue = 'RISPOSTA_ORIGINALE'): CallHandler {
  return { handle: () => of(responseValue) };
}

/** Helper: esegue l'interceptor e restituisce il valore emesso dall'Observable. */
async function runInterceptor(
  interceptor: TenantSwitchInterceptor,
  ctx: ExecutionContext,
  handler: CallHandler,
): Promise<unknown> {
  const obs = interceptor.intercept(ctx, handler);
  return lastValueFrom(obs);
}

describe('TenantSwitchInterceptor', () => {
  let membershipMock: jest.Mocked<MembershipService>;
  let interceptor: TenantSwitchInterceptor;

  beforeEach(() => {
    membershipMock = {
      checkAccess: jest.fn(),
      listTenants: jest.fn(),
      switchTenant: jest.fn(),
    } as unknown as jest.Mocked<MembershipService>;

    interceptor = new TenantSwitchInterceptor(membershipMock);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 1: Nessun header → passthrough
  // ──────────────────────────────────────────────────────────────────────────
  it('senza header X-Tenant-ID passa al handler senza modifiche', async () => {
    const ctx = makeContext(undefined, USER_NORMALE, TENANT_A);
    const handler = makeHandler();

    const result = await runInterceptor(interceptor, ctx, handler);

    expect(result).toBe('RISPOSTA_ORIGINALE');
    expect(membershipMock.checkAccess).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 2: SUPER_ADMIN → passthrough (middleware già gestisce)
  // ──────────────────────────────────────────────────────────────────────────
  it('SUPER_ADMIN con header → passthrough (non tocca la membership)', async () => {
    const ctx = makeContext(TENANT_B, USER_SUPER_ADMIN, '');
    const handler = makeHandler();

    const result = await runInterceptor(interceptor, ctx, handler);

    expect(result).toBe('RISPOSTA_ORIGINALE');
    expect(membershipMock.checkAccess).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 3: Header = tenant primario → autorizzato senza query DB
  // ──────────────────────────────────────────────────────────────────────────
  it('header uguale al tenant primario → autorizzato (checkAccess restituisce true senza query aggiuntive)', async () => {
    membershipMock.checkAccess.mockResolvedValue(true);
    const ctx = makeContext(TENANT_A, USER_NORMALE, TENANT_A);
    let tenantInContesto: string | null = null;

    const handler: CallHandler = {
      handle: () => {
        // Cattura il tenant attivo nel contesto al momento dell'esecuzione.
        tenantInContesto = TenantContext.getTenantId();
        return of('OK');
      },
    };

    await runInterceptor(interceptor, ctx, handler);

    // Il metodo checkAccess viene chiamato: il tenant primario è uguale → true immediato.
    // Il TenantContext viene sovrascritto con TENANT_A (che era già quello corretto).
    expect(tenantInContesto).toBe(TENANT_A);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 4 (CRITICO ANTI-LEAK): header di tenant NON autorizzato → fail-closed
  // ──────────────────────────────────────────────────────────────────────────
  it('ANTI-LEAK: header X-Tenant-ID di tenant non autorizzato → ignorato, usa tenant primario', async () => {
    membershipMock.checkAccess.mockResolvedValue(false);
    const ctx = makeContext(TENANT_C, USER_NORMALE, TENANT_A);
    let tenantInContesto: string | null = null;
    const reqObj = (ctx.switchToHttp().getRequest()) as any;

    const handler: CallHandler = {
      handle: () => {
        tenantInContesto = TenantContext.getTenantId();
        return of('OK');
      },
    };

    // L'interceptor deve chiamare next.handle() senza cambiare il TenantContext.
    // Il TenantContext rimane quello impostato dal middleware (TENANT_A, dal JWT).
    // Simuliamo: avvolgiamo l'esecuzione in TenantContext.run con TENANT_A.
    await TenantContext.run({ tenantId: TENANT_A }, async () => {
      await runInterceptor(interceptor, ctx, handler);
      expect(tenantInContesto).toBe(TENANT_A); // Il contesto NON è stato sovrascritto con TENANT_C
    });

    // req.tenantId non deve essere stato aggiornato con il tenant C.
    expect(reqObj.tenantId).toBe(TENANT_A);
    expect(membershipMock.checkAccess).toHaveBeenCalledWith(
      USER_NORMALE.id,
      TENANT_C,
      TENANT_A,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 5: utente membro del tenant B → switch autorizzato
  // ──────────────────────────────────────────────────────────────────────────
  it('header X-Tenant-ID di tenant autorizzato → TenantContext sovrascritto con tenant B', async () => {
    membershipMock.checkAccess.mockResolvedValue(true);
    const ctx = makeContext(TENANT_B, USER_NORMALE, TENANT_A);
    const reqObj = ctx.switchToHttp().getRequest() as any;
    let tenantInContesto: string | null = null;

    const handler: CallHandler = {
      handle: () => {
        tenantInContesto = TenantContext.getTenantId();
        return of('DATI_TENANT_B');
      },
    };

    // Avvolgiamo con il contesto del middleware (TENANT_A).
    await TenantContext.run({ tenantId: TENANT_A }, async () => {
      const result = await runInterceptor(interceptor, ctx, handler);
      expect(result).toBe('DATI_TENANT_B');
    });

    // Il TenantContext durante l'esecuzione dell'handler deve essere TENANT_B.
    expect(tenantInContesto).toBe(TENANT_B);
    // req.tenantId deve essere aggiornato a TENANT_B.
    expect(reqObj.tenantId).toBe(TENANT_B);
    expect(membershipMock.checkAccess).toHaveBeenCalledWith(
      USER_NORMALE.id,
      TENANT_B,
      TENANT_A,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 6: errore DB → fail-closed (non espone l'errore al client)
  // ──────────────────────────────────────────────────────────────────────────
  it('errore DB nella verifica → fail-closed, usa tenant primario senza eccezione', async () => {
    membershipMock.checkAccess.mockRejectedValue(new Error('DB connection lost'));
    const ctx = makeContext(TENANT_B, USER_NORMALE, TENANT_A);
    let tenantInContesto: string | null = null;

    const handler: CallHandler = {
      handle: () => {
        tenantInContesto = TenantContext.getTenantId();
        return of('OK');
      },
    };

    await TenantContext.run({ tenantId: TENANT_A }, async () => {
      // Non deve lanciare, deve ricadere silenziosamente sul tenant primario.
      const result = await runInterceptor(interceptor, ctx, handler);
      expect(result).toBe('OK');
      expect(tenantInContesto).toBe(TENANT_A); // Non sovrascritto
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 7: utente non autenticato (rotta pubblica con header) → passthrough
  // ──────────────────────────────────────────────────────────────────────────
  it('utente non autenticato con header → passthrough senza verifica', async () => {
    const ctx = makeContext(TENANT_B, null);
    const handler = makeHandler();

    const result = await runInterceptor(interceptor, ctx, handler);

    expect(result).toBe('RISPOSTA_ORIGINALE');
    expect(membershipMock.checkAccess).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scenario 8: contesto non HTTP (es. WebSocket/gRPC) → passthrough
  // ──────────────────────────────────────────────────────────────────────────
  it('contesto non HTTP → passthrough senza verifica', async () => {
    const nonHttpCtx = {
      getType: () => 'ws',
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    const handler = makeHandler();

    const result = await runInterceptor(interceptor, nonHttpCtx, handler);

    expect(result).toBe('RISPOSTA_ORIGINALE');
    expect(membershipMock.checkAccess).not.toHaveBeenCalled();
  });
});
