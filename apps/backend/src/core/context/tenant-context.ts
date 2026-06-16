import { AsyncLocalStorage } from 'async_hooks';

/**
 * Dati legati al contesto della richiesta corrente.
 */
export interface TenantStore {
  /**
   * Tenant (società) su cui la richiesta sta operando.
   *
   * Per un utente normale è il tenant del suo JWT (sempre valorizzato).
   * Per un SUPER_ADMIN può essere:
   *   · una stringa vuota / undefined → opera cross-tenant (nessun vincolo);
   *   · il tenant indicato da `X-Tenant-ID` → opera "impersonando" quel tenant.
   */
  tenantId?: string;
  /** Utente autenticato (opzionale: assente nei job di sistema). */
  userId?: string;
  /**
   * `true` quando l'utente autenticato ha ruolo SUPER_ADMIN (amministratore di
   * piattaforma cross-tenant). Determinato SOLO dal ruolo verificato nel JWT,
   * mai inferito da header. Quando `true`, l'estensione RLS NON applica il
   * filtro per tenant — a meno che `tenantId` (da `X-Tenant-ID`) sia presente.
   */
  isSuperAdmin?: boolean;
}

/**
 * TenantContext — contesto multi-tenant per-richiesta basato su AsyncLocalStorage.
 *
 * È il punto UNICO da cui l'infrastruttura risolve il "tenant corrente". Sostituisce
 * il vecchio `getContextTenantId()` che faceva `prisma.tenant.findFirst()` e quindi
 * ritornava SEMPRE il primo tenant del DB, causando un cross-tenant data leak nello
 * scenario "consulente che opera su più società".
 *
 * Risoluzione del tenant (in ordine):
 *   1. store AsyncLocalStorage — popolato dal TenantContextMiddleware nel ciclo di
 *      richiesta HTTP a partire dal JWT (produzione).
 *   2. process.env.CURRENT_TENANT_ID — per job in background, script CLI e test.
 *
 * Fail-closed: `requireTenantId()` LANCIA se nessun tenant è nel contesto, invece di
 * ricadere su un default. Meglio rifiutare l'operazione che scriverla sul tenant
 * sbagliato.
 *
 * È implementato come singleton statico perché i repository sono istanziati con la
 * sola dipendenza da PrismaService e non possono ricevere il contesto via costruttore.
 */
export class TenantContext {
  private static readonly als = new AsyncLocalStorage<TenantStore>();

  /**
   * Esegue `callback` (e tutte le continuazioni async che ne derivano) dentro un
   * contesto legato al tenant indicato. Usato dal middleware per ogni richiesta e
   * dai job di sistema che operano per conto di un tenant specifico.
   */
  static run<T>(store: TenantStore, callback: () => T): T {
    return TenantContext.als.run(store, callback);
  }

  /** Tenant corrente, oppure `null` se non determinabile. */
  static getTenantId(): string | null {
    const fromStore = TenantContext.als.getStore()?.tenantId;
    if (fromStore) {
      return fromStore;
    }
    const fromEnv = process.env.CURRENT_TENANT_ID;
    return fromEnv && fromEnv.length > 0 ? fromEnv : null;
  }

  /** Tenant corrente, oppure lancia (fail-closed). */
  static requireTenantId(): string {
    const tenantId = TenantContext.getTenantId();
    if (!tenantId) {
      throw new Error(
        'TenantContext: tenant corrente non disponibile. La richiesta deve passare ' +
          'dal TenantContextMiddleware (JWT), oppure il job deve eseguire dentro ' +
          'TenantContext.run({ tenantId }, ...).',
      );
    }
    return tenantId;
  }

  /**
   * `true` se la richiesta corrente è eseguita da un SUPER_ADMIN (amministratore
   * di piattaforma). Letto SOLO dallo store popolato dal middleware a partire dal
   * ruolo verificato nel JWT — mai da un header. Fuori da un contesto di richiesta
   * (job/seed) ritorna `false` (fail-closed: nessun bypass implicito).
   */
  static isSuperAdmin(): boolean {
    return TenantContext.als.getStore()?.isSuperAdmin === true;
  }

  /** Utente corrente, oppure `null`. */
  static getUserId(): string | null {
    return TenantContext.als.getStore()?.userId ?? null;
  }
}
