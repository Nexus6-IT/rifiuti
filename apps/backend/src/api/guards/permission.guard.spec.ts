import { TenantContext } from '../../core/context/tenant-context'
import { AZIENDA_PIATTAFORMA_ID } from '../../core/context/azienda-piattaforma'
import { ExecutionContext, ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PermissionGuard } from './permission.guard'
import { UserRole } from '../../domain/identity-access/user-role.entity'
import { Permission } from '../../domain/identity-access/permission.entity'

/**
 * PermissionGuard unit tests
 *
 * Security focus (P0):
 *  1. Cache MISS must NOT blindly deny: the guard must load permissions from the
 *     database (UserRoleRepository + PermissionRepository), populate the cache and
 *     then evaluate. A legitimate user with a valid DB permission but an empty
 *     cache must be AUTHORIZED.
 *  2. ABAC resource attributes must NOT be built by spreading the raw request body
 *     (spoofable). The body must never influence the authorization decision.
 */
describe('PermissionGuard', () => {
  let guard: PermissionGuard

  // Mocks
  let reflector: jest.Mocked<Reflector>
  let permissionCache: any
  let auditLogRepository: any
  let auditQueue: any
  let abacEvaluator: any
  let abacPolicyRepository: any
  let userRoleRepository: any
  let permissionRepository: any
  let ruoloEffettivo: any

  const TENANT_ID = 'tenant-1'
  const USER_ID = 'user-1'

  // `@RuoloDelToken` presente o no sulla rotta (il Reflector e' un mock: una chiave per volta).
  let conRuoloDelToken = false
  const impostaPermesso = (permesso: string | undefined) => {
    reflector.getAllAndOverride.mockImplementation(((chiave: string) =>
      chiave === 'ruoloDelToken' ? conRuoloDelToken : permesso) as any)
  }

  const buildContext = (overrides: Partial<any> = {}): ExecutionContext => {
    const request = {
      // `request.user` è popolato da JwtStrategy con la proprietà `id` (vedi
      // `CurrentUserPayload`), MAI `userId` — bug trovato durante la verifica
      // dal vivo P4 (2026-07-25): il guard leggeva `user.userId` (sempre
      // undefined), rendendo la cache dei permessi condivisa fra tutti gli
      // utenti di uno stesso tenant. Il mock qui rispecchia la forma reale.
      user: { id: USER_ID, tenantId: TENANT_ID, role: 'OPERATOR' },
      body: {},
      params: {},
      headers: {},
      ip: '127.0.0.1',
      ...overrides,
    }

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext
  }

  beforeEach(() => {
    conRuoloDelToken = false
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>

    permissionCache = {
      getPermissions: jest.fn(),
      setPermissions: jest.fn().mockResolvedValue(undefined),
    }

    auditLogRepository = {}

    auditQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    }

    abacEvaluator = {
      evaluate: jest.fn(),
    }

    abacPolicyRepository = {
      findActiveByResourceType: jest.fn().mockResolvedValue([]),
    }

    userRoleRepository = {
      findActiveByUserId: jest.fn().mockResolvedValue([]),
    }

    permissionRepository = {
      findByRole: jest.fn().mockResolvedValue([]),
    }

    // Nessun legame con l'azienda candidata, salvo i test che lo impostano.
    ruoloEffettivo = {
      accessoConOrigine: jest.fn().mockResolvedValue(null),
      permessiDelRuolo: jest.fn().mockResolvedValue([]),
    }

    guard = new PermissionGuard(
      reflector,
      permissionCache,
      auditLogRepository,
      auditQueue,
      abacEvaluator,
      abacPolicyRepository,
      userRoleRepository,
      permissionRepository,
      ruoloEffettivo
    )
  })

  it('allows access when no @RequirePermission decorator is present', async () => {
    impostaPermesso(undefined)

    await expect(guard.canActivate(buildContext())).resolves.toBe(true)
  })

  it('throws ForbiddenException when no authenticated user is present', async () => {
    impostaPermesso('fir:read:facility')

    await expect(guard.canActivate(buildContext({ user: undefined }))).rejects.toBeInstanceOf(
      ForbiddenException
    )
  })

  it('grants access on cache HIT when permission is present', async () => {
    impostaPermesso('fir:read:facility')
    permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

    await expect(guard.canActivate(buildContext())).resolves.toBe(true)
    // No DB fallback needed on a cache hit
    expect(userRoleRepository.findActiveByUserId).not.toHaveBeenCalled()
  })

  describe('audit senza azienda', () => {
    const lascia = async () => await new Promise(r => setImmediate(r))

    it('permission.guard: super admin senza azienda accodato nell azienda piattaforma', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      const ctx = buildContext({ user: { id: USER_ID, tenantId: '', role: 'SUPER_ADMIN' } })
      await expect(guard.canActivate(ctx)).resolves.toBe(true)
      await lascia()

      expect(auditQueue.add).toHaveBeenCalledTimes(1)
      expect(auditQueue.add.mock.calls[0][1].data.tenantId).toBe(AZIENDA_PIATTAFORMA_ID)
    })

    it('permission.guard: utente normale senza azienda non accodato', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      const ctx = buildContext({ user: { id: USER_ID, tenantId: '', role: 'ADMIN' } })
      await expect(guard.canActivate(ctx)).resolves.toBe(true)
      await lascia()

      expect(auditQueue.add).not.toHaveBeenCalled()
    })

    const AZIENDA_B = '33333333-3333-4333-8333-333333333333'

    it('super admin con X-Tenant-ID: audit nell azienda scelta, permessi letti nel contesto di casa', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(null)
      let contestoLettura: string | null = null
      userRoleRepository.findActiveByUserId.mockImplementation(async () => {
        contestoLettura = TenantContext.getTenantId()
        return []
      })

      const ctx = buildContext({
        user: { id: USER_ID, tenantId: TENANT_ID, role: 'SUPER_ADMIN' },
        headers: { 'x-tenant-id': AZIENDA_B },
        tenantId: AZIENDA_B,
      })
      await TenantContext.run({ tenantId: AZIENDA_B }, async () => {
        await expect(guard.canActivate(ctx)).rejects.toBeDefined()
      })
      await lascia()

      expect(userRoleRepository.findActiveByUserId).toHaveBeenCalledWith(USER_ID, TENANT_ID)
      expect(contestoLettura).toBe(TENANT_ID)
      expect(auditQueue.add.mock.calls[0][1].data.tenantId).toBe(AZIENDA_B)
    })

    it('super admin senza X-Tenant-ID (con azienda di casa nel token): audit nella piattaforma', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      const ctx = buildContext({ user: { id: USER_ID, tenantId: TENANT_ID, role: 'SUPER_ADMIN' } })
      await expect(guard.canActivate(ctx)).resolves.toBe(true)
      await lascia()

      expect(auditQueue.add.mock.calls[0][1].data.tenantId).toBe(AZIENDA_PIATTAFORMA_ID)
    })

    it('utente normale: l header X-Tenant-ID e ignorato, audit nell azienda del token', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      const ctx = buildContext({ headers: { 'x-tenant-id': AZIENDA_B } })
      await expect(guard.canActivate(ctx)).resolves.toBe(true)
      await lascia()

      expect(auditQueue.add.mock.calls[0][1].data.tenantId).toBe(TENANT_ID)
    })

    it('l audit porta codice fiscale e sessione dell utente', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      const ctx = buildContext({
        user: {
          id: USER_ID,
          tenantId: TENANT_ID,
          role: 'OPERATOR',
          fiscalCode: 'RSSMRA80A01H501U',
          sessionId: 'abc123',
        },
      })
      await guard.canActivate(ctx)
      await lascia()

      const dati = auditQueue.add.mock.calls[0][1].data
      expect(dati.spidFiscalCode).toBe('RSSMRA80A01H501U')
      expect(dati.sessionId).toBe('abc123')
    })

    it('con un tenantId valorizzato l evento si accoda', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      await expect(guard.canActivate(buildContext())).resolves.toBe(true)
      await lascia()

      expect(auditQueue.add).toHaveBeenCalledTimes(1)
    })
  })

  describe('cache MISS -> DB fallback (P0 bug #1)', () => {
    it('loads permissions from DB and AUTHORIZES a legitimate user when cache is empty', async () => {
      impostaPermesso('fir:read:facility')
      // Cache empty
      permissionCache.getPermissions.mockResolvedValue(null)

      // DB: user has one active role granting the required permission
      const userRole = UserRole.create({
        userId: USER_ID,
        roleId: 'role-1',
        tenantId: TENANT_ID,
        assignedBy: 'admin-1',
      })
      userRoleRepository.findActiveByUserId.mockResolvedValue([userRole])

      const permission = Permission.fromString(
        'fir:read:facility',
        'Read FIR at facility scope',
        'FIR'
      )
      permissionRepository.findByRole.mockResolvedValue([permission])

      await expect(guard.canActivate(buildContext())).resolves.toBe(true)

      // It must have consulted the DB on the cache miss
      expect(userRoleRepository.findActiveByUserId).toHaveBeenCalledWith(USER_ID, TENANT_ID)
      expect(permissionRepository.findByRole).toHaveBeenCalledWith('role-1')

      // It must have populated the cache with the loaded permissions
      expect(permissionCache.setPermissions).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        expect.arrayContaining(['fir:read:facility'])
      )
    })

    it('denies access on cache miss when the DB grants no matching permission', async () => {
      impostaPermesso('fir:delete:all')
      permissionCache.getPermissions.mockResolvedValue(null)

      const userRole = UserRole.create({
        userId: USER_ID,
        roleId: 'role-1',
        tenantId: TENANT_ID,
        assignedBy: 'admin-1',
      })
      userRoleRepository.findActiveByUserId.mockResolvedValue([userRole])
      permissionRepository.findByRole.mockResolvedValue([
        Permission.fromString('fir:read:own', 'desc', 'FIR'),
      ])

      await expect(guard.canActivate(buildContext())).rejects.toBeInstanceOf(ForbiddenException)
      // Still must have attempted the DB load (no blind deny)
      expect(userRoleRepository.findActiveByUserId).toHaveBeenCalled()
    })
  })

  describe('ABAC must not trust the request body (P0 bug #2)', () => {
    it('does not pass spoofed body attributes into the ABAC evaluation context', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      // Active ABAC policy so the evaluator gets invoked
      abacPolicyRepository.findActiveByResourceType.mockResolvedValue([{ id: 'policy-1' }])
      abacEvaluator.evaluate.mockResolvedValue({
        decision: 'ALLOW',
        totalEvaluationTimeMs: 1,
        evaluatedPolicies: [],
      })

      // Attacker tries to inject ownerId into the body to spoof ABAC
      const context = buildContext({
        body: { ownerId: 'attacker-controlled', isApproved: true },
        params: { id: 'resource-9' },
      })

      await guard.canActivate(context)

      expect(abacEvaluator.evaluate).toHaveBeenCalledTimes(1)
      const evaluationContext = abacEvaluator.evaluate.mock.calls[0][1]

      // The spoofed body values must NOT leak into the resource attributes
      expect(evaluationContext.resource.ownerId).not.toBe('attacker-controlled')
      expect(evaluationContext.resource.isApproved).toBeUndefined()
    })
  })

  describe('permessi nell azienda selezionata (X-Tenant-ID)', () => {
    const CLIENTE = '44444444-4444-4444-8444-444444444444'
    const FIGLIA = '55555555-5555-4555-8555-555555555555'
    const RUOLO_ASSOCIAZIONE = 'ruolo-associazione'
    const lascia = async () => await new Promise(r => setImmediate(r))

    /** Cache in memoria con la stessa chiave (azienda, utente) di PermissionCacheService. */
    const cacheInMemoria = () => {
      const voci = new Map<string, string[]>()
      permissionCache.getPermissions.mockImplementation(
        async (t: string, u: string) => voci.get(`${t}:${u}`) ?? null
      )
      permissionCache.setPermissions.mockImplementation(
        async (t: string, u: string, p: string[]) => {
          voci.set(`${t}:${u}`, p)
        }
      )
      return voci
    }

    /** A casa il consulente e' ADMIN con i permessi indicati. */
    const permessiDiCasa = (...permessi: string[]) => {
      userRoleRepository.findActiveByUserId.mockResolvedValue([
        UserRole.create({
          userId: USER_ID,
          roleId: 'ruolo-casa',
          tenantId: TENANT_ID,
          assignedBy: 'admin-1',
        }),
      ])
      permissionRepository.findByRole.mockResolvedValue(
        permessi.map(p => Permission.fromString(p, 'desc', 'FIR'))
      )
    }

    const ctxCliente = (azienda: string | null = CLIENTE) =>
      buildContext({
        user: { id: USER_ID, tenantId: TENANT_ID, role: 'ADMIN' },
        headers: azienda ? { 'x-tenant-id': azienda } : {},
      })

    it('consulente con permessi ampi a casa: il ruolo dell associazione privo del permesso nega', async () => {
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      permessiDiCasa('fir:write:all')
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({
        ruolo: 'VIEWER',
        roleId: RUOLO_ASSOCIAZIONE,
      })
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:read:all'])

      await expect(guard.canActivate(ctxCliente())).rejects.toBeInstanceOf(ForbiddenException)

      expect(ruoloEffettivo.permessiDelRuolo).toHaveBeenCalledWith(RUOLO_ASSOCIAZIONE)
      // I permessi di casa non vengono nemmeno letti: non contano presso il cliente.
      expect(userRoleRepository.findActiveByUserId).not.toHaveBeenCalled()
    })

    it('associazione con un ruolo che ha il permesso: concesso, voce di cache del cliente con TTL breve, audit nel cliente', async () => {
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({
        ruolo: 'ADMIN',
        roleId: RUOLO_ASSOCIAZIONE,
      })
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:write:all'])

      await expect(guard.canActivate(ctxCliente())).resolves.toBe(true)
      await lascia()

      expect(permissionCache.setPermissions).toHaveBeenCalledWith(
        CLIENTE,
        `assoc:${RUOLO_ASSOCIAZIONE}:${USER_ID}`,
        ['fir:write:all'],
        60
      )
      expect(auditQueue.add.mock.calls[0][1].data.tenantId).toBe(CLIENTE)
    })

    it("associazione con ruolo scambiato: la voce di cache e' un'altra, vale subito", async () => {
      impostaPermesso('fir:write:all')
      const voci = cacheInMemoria()
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({ ruolo: 'ADMIN', roleId: 'ruolo-a' })
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:write:all'])
      await expect(guard.canActivate(ctxCliente())).resolves.toBe(true)

      ruoloEffettivo.accessoConOrigine.mockResolvedValue({ ruolo: 'VIEWER', roleId: 'ruolo-b' })
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:read:all'])
      await expect(guard.canActivate(ctxCliente())).rejects.toBeInstanceOf(ForbiddenException)

      expect([...voci.keys()]).toEqual(
        expect.arrayContaining([
          `${CLIENTE}:assoc:ruolo-a:${USER_ID}`,
          `${CLIENTE}:assoc:ruolo-b:${USER_ID}`,
        ])
      )
    })

    it("403: currentRole e' il ruolo effettivo nell'azienda selezionata, non quello del token", async () => {
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({
        ruolo: 'VIEWER',
        roleId: RUOLO_ASSOCIAZIONE,
      })
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:read:all'])

      const errore = await guard.canActivate(ctxCliente()).then(
        () => null,
        (e: unknown) => e
      )

      expect((errore as ForbiddenException).getResponse()).toMatchObject({ currentRole: 'VIEWER' })
    })

    it('@RuoloDelToken: decidono i permessi del token, accessoConOrigine mai chiamato', async () => {
      conRuoloDelToken = true
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      permessiDiCasa('fir:write:all')
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({
        ruolo: 'VIEWER',
        roleId: RUOLO_ASSOCIAZIONE,
      })

      await expect(guard.canActivate(ctxCliente())).resolves.toBe(true)

      expect(ruoloEffettivo.accessoConOrigine).not.toHaveBeenCalled()
      expect(ruoloEffettivo.permessiDelRuolo).not.toHaveBeenCalled()
    })

    it('due richieste dello stesso utente, casa e cliente, non si contaminano attraverso la cache', async () => {
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      permessiDiCasa('fir:write:all')
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({
        ruolo: 'VIEWER',
        roleId: RUOLO_ASSOCIAZIONE,
      })
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:read:all'])

      // casa (concesso, riempie la voce di casa) -> cliente (negato) -> casa -> cliente
      await expect(guard.canActivate(ctxCliente(null))).resolves.toBe(true)
      await expect(guard.canActivate(ctxCliente())).rejects.toBeInstanceOf(ForbiddenException)
      await expect(guard.canActivate(ctxCliente(null))).resolves.toBe(true)
      await expect(guard.canActivate(ctxCliente())).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('il contrario: voce del cliente permissiva, casa che nega, nessun riuso', async () => {
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      permessiDiCasa('fir:read:all')
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({
        ruolo: 'ADMIN',
        roleId: RUOLO_ASSOCIAZIONE,
      })
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:write:all'])

      await expect(guard.canActivate(ctxCliente())).resolves.toBe(true)
      await expect(guard.canActivate(ctxCliente(null))).rejects.toBeInstanceOf(ForbiddenException)
      await expect(guard.canActivate(ctxCliente())).resolves.toBe(true)
    })

    it('utente di gruppo sulla figlia: permessi di casa, voce di cache di casa, audit nella figlia', async () => {
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      permessiDiCasa('fir:write:all')
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({ ruolo: 'ADMIN', roleId: null })

      await expect(guard.canActivate(ctxCliente(FIGLIA))).resolves.toBe(true)
      await lascia()

      expect(ruoloEffettivo.permessiDelRuolo).not.toHaveBeenCalled()
      expect(permissionCache.setPermissions).toHaveBeenCalledWith(TENANT_ID, USER_ID, [
        'fir:write:all',
      ])
      expect(auditQueue.add.mock.calls[0][1].data.tenantId).toBe(FIGLIA)
    })

    it('nessun legame con l azienda: si decide come col token (permessi di casa, audit di casa)', async () => {
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      permessiDiCasa('fir:write:all')
      ruoloEffettivo.accessoConOrigine.mockResolvedValue(null)

      await expect(guard.canActivate(ctxCliente())).resolves.toBe(true)
      await lascia()

      expect(ruoloEffettivo.permessiDelRuolo).not.toHaveBeenCalled()
      expect(auditQueue.add.mock.calls[0][1].data.tenantId).toBe(TENANT_ID)
    })

    it('voce (cliente, utente) scritta da un altro componente: il guard usa i permessi dell associazione', async () => {
      impostaPermesso('fir:write:all')
      const voci = cacheInMemoria()
      // GetUserPermissionsQueryHandler scrive le assegnazioni dirette nel cliente (qui: vuote,
      // poi ampie) sotto la chiave (cliente, utente).
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({
        ruolo: 'ADMIN',
        roleId: RUOLO_ASSOCIAZIONE,
      })
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:write:all'])
      voci.set(`${CLIENTE}:${USER_ID}`, [])
      await expect(guard.canActivate(ctxCliente())).resolves.toBe(true)

      voci.clear()
      voci.set(`${CLIENTE}:${USER_ID}`, ['fir:write:all'])
      ruoloEffettivo.permessiDelRuolo.mockResolvedValue(['fir:read:all'])
      await expect(guard.canActivate(ctxCliente())).rejects.toBeInstanceOf(ForbiddenException)
      // La voce dell'altro componente non e' stata toccata.
      expect(voci.get(`${CLIENTE}:${USER_ID}`)).toEqual(['fir:write:all'])
    })

    it('lettura dei permessi del ruolo non riuscita: 503 VERIFICA_AZIENDA_NON_DISPONIBILE, non 403', async () => {
      impostaPermesso('fir:write:all')
      cacheInMemoria()
      ruoloEffettivo.accessoConOrigine.mockResolvedValue({
        ruolo: 'ADMIN',
        roleId: RUOLO_ASSOCIAZIONE,
      })
      ruoloEffettivo.permessiDelRuolo.mockRejectedValue(new Error('connessione persa: segreto'))

      const errore = await guard.canActivate(ctxCliente()).catch(e => e)

      expect(errore).toBeInstanceOf(ServiceUnavailableException)
      expect(errore.getResponse()).toMatchObject({ error: 'VERIFICA_AZIENDA_NON_DISPONIBILE' })
      expect(JSON.stringify(errore.getResponse())).not.toContain('segreto')
      expect(permissionCache.setPermissions).not.toHaveBeenCalled()
    })

    it('verifica non possibile (database): 503 VERIFICA_AZIENDA_NON_DISPONIBILE, mai 500 ne via libera', async () => {
      impostaPermesso('fir:write:all')
      permissionCache.getPermissions.mockResolvedValue(['fir:write:all'])
      ruoloEffettivo.accessoConOrigine.mockRejectedValue(
        new Error('connessione a postgres://u:segreto@db rifiutata')
      )

      const errore = await guard.canActivate(ctxCliente()).catch(e => e)

      expect(errore).toBeInstanceOf(ServiceUnavailableException)
      expect(errore.getResponse()).toMatchObject({ error: 'VERIFICA_AZIENDA_NON_DISPONIBILE' })
      expect(JSON.stringify(errore.getResponse())).not.toContain('segreto')
      expect(permissionCache.getPermissions).not.toHaveBeenCalled()
    })

    it('header uguale all azienda di casa o assente: nessuna verifica, comportamento di sempre', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      await guard.canActivate(ctxCliente(null))
      const CASA_UUID = '66666666-6666-4666-8666-666666666666'
      await guard.canActivate(
        buildContext({
          user: { id: USER_ID, tenantId: CASA_UUID, role: 'ADMIN' },
          headers: { 'x-tenant-id': CASA_UUID },
        })
      )

      expect(ruoloEffettivo.accessoConOrigine).not.toHaveBeenCalled()
    })

    it('SUPER_ADMIN con X-Tenant-ID: invariato, nessuna risoluzione per associazione', async () => {
      impostaPermesso('fir:read:facility')
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      const ctx = buildContext({
        user: { id: USER_ID, tenantId: TENANT_ID, role: 'SUPER_ADMIN' },
        headers: { 'x-tenant-id': CLIENTE },
      })
      await expect(guard.canActivate(ctx)).resolves.toBe(true)
      await lascia()

      expect(ruoloEffettivo.accessoConOrigine).not.toHaveBeenCalled()
      expect(permissionCache.getPermissions).toHaveBeenCalledWith(TENANT_ID, USER_ID)
      expect(auditQueue.add.mock.calls[0][1].data.tenantId).toBe(CLIENTE)
    })
  })
})
