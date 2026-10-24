/**
 * MembershipService — accesso multi-azienda.
 *
 * Regola: un'associazione consulente SCADUTA non dà più accesso all'azienda
 * cliente. Il dominio lo dichiara già (`isActiveAndNotExpired()`), ma le query
 * di accesso filtravano solo su `isActive`: un consulente con associazione
 * scaduta continuava a poter leggere e scrivere nell'azienda del cliente.
 */

import { ForbiddenException } from '@nestjs/common'
import { MembershipService } from './membership.service'
import { TenantContext } from '../../core/context/tenant-context'

const UTENTE = 'consulente-uuid'
const TENANT_PRIMARIO = 'tenant-A-uuid'
const TENANT_CLIENTE = 'tenant-B-uuid'

/**
 * Prisma finto che si comporta come il DB: applica davvero i filtri `where`
 * sull'associazione, così il test verifica la query e non un mock compiacente.
 */
function makePrisma(associazione: { isActive: boolean; expiresAt: Date | null } | null) {
  const soddisfa = (where: any): boolean => {
    if (!associazione) return false
    if (where.consultantUserId !== UTENTE) return false
    if (where.tenantId !== TENANT_CLIENTE) return false
    if (where.isActive === true && !associazione.isActive) return false
    if (where.OR) {
      const ok = where.OR.some((clausola: any) => {
        if ('expiresAt' in clausola && clausola.expiresAt === null) {
          return associazione.expiresAt === null
        }
        if (clausola.expiresAt?.gt instanceof Date) {
          return associazione.expiresAt !== null && associazione.expiresAt > clausola.expiresAt.gt
        }
        return false
      })
      if (!ok) return false
    }
    return true
  }

  return {
    tenant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: TENANT_CLIENTE }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    consultantTenantAssociation: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(soddisfa(where) ? { id: 'a1' } : null)
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ email: 'c@example.it', fiscalCode: 'CF', role: 'OPERATOR' }),
    },
  } as any
}

// Negli spec esistenti un solo mock fa da client app e da client di sistema: le asserzioni restano quelle di prima.
const creaMembership = (prisma: any, jwt: any) => new MembershipService(prisma, prisma, jwt)

const jwtTokens = {
  generateTokenPair: () => ({ accessToken: 'a', refreshToken: 'r' }),
} as any

const IERI = new Date(Date.now() - 24 * 60 * 60 * 1000)
const DOMANI = new Date(Date.now() + 24 * 60 * 60 * 1000)

describe('MembershipService — associazione consulente scaduta', () => {
  it('nega checkAccess quando l’associazione è scaduta', async () => {
    const service = creaMembership(makePrisma({ isActive: true, expiresAt: IERI }), jwtTokens)

    await expect(service.checkAccess(UTENTE, TENANT_CLIENTE, TENANT_PRIMARIO)).resolves.toBe(false)
  })

  it('consente checkAccess con associazione attiva non scaduta', async () => {
    const service = creaMembership(makePrisma({ isActive: true, expiresAt: DOMANI }), jwtTokens)

    await expect(service.checkAccess(UTENTE, TENANT_CLIENTE, TENANT_PRIMARIO)).resolves.toBe(true)
  })

  it('consente checkAccess con associazione senza scadenza', async () => {
    const service = creaMembership(makePrisma({ isActive: true, expiresAt: null }), jwtTokens)

    await expect(service.checkAccess(UTENTE, TENANT_CLIENTE, TENANT_PRIMARIO)).resolves.toBe(true)
  })

  it('rifiuta lo switch di azienda su associazione scaduta', async () => {
    const service = creaMembership(makePrisma({ isActive: true, expiresAt: IERI }), jwtTokens)

    await expect(
      service.switchTenant(
        { id: UTENTE, tenantId: TENANT_PRIMARIO, role: 'OPERATOR' } as any,
        TENANT_CLIENTE
      )
    ).rejects.toThrow(ForbiddenException)
  })
})

describe('MembershipService — gerarchia madre-figlie', () => {
  const MADRE = 'tenant-madre-uuid'
  const FIGLIA = 'tenant-figlia-uuid'
  const SORELLA = 'tenant-sorella-uuid'
  const UTENTE_MADRE = 'utente-madre-uuid'
  const UTENTE_FIGLIA = 'utente-figlia-uuid'

  /** Prisma finto: gerarchia + proprieta' + associazioni consulente. */
  function makePrismaGerarchia() {
    const tenants: Record<string, any> = {
      [MADRE]: { id: MADRE, parentTenantId: null, ownerUserId: UTENTE_MADRE },
      [FIGLIA]: { id: FIGLIA, parentTenantId: MADRE, ownerUserId: null },
      [SORELLA]: { id: SORELLA, parentTenantId: MADRE, ownerUserId: null },
    }
    return {
      tenant: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(tenants[where.id] ?? null)),
        findFirst: jest.fn(({ where }: any) => {
          const t = tenants[where.id]
          if (!t) return Promise.resolve(null)
          if (where.ownerUserId && t.ownerUserId !== where.ownerUserId) return Promise.resolve(null)
          return Promise.resolve({ id: t.id })
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      consultantTenantAssociation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any
  }

  it('chi e abilitato alla madre accede a una figlia', async () => {
    const service = creaMembership(makePrismaGerarchia(), jwtTokens)

    await expect(service.checkAccess(UTENTE_MADRE, FIGLIA, MADRE)).resolves.toBe(true)
  })

  it('chi e abilitato a una figlia NON accede alla sorella', async () => {
    const service = creaMembership(makePrismaGerarchia(), jwtTokens)

    await expect(service.checkAccess(UTENTE_FIGLIA, SORELLA, FIGLIA)).resolves.toBe(false)
  })

  it('chi e abilitato a una figlia NON risale alla madre', async () => {
    const service = creaMembership(makePrismaGerarchia(), jwtTokens)

    await expect(service.checkAccess(UTENTE_FIGLIA, MADRE, FIGLIA)).resolves.toBe(false)
  })

  it('l elenco aziende include le figlie della madre, col legame', async () => {
    const prisma = makePrismaGerarchia()
    prisma.tenant.findMany = jest.fn(({ where }: any) => {
      if (where.parentTenantId) return Promise.resolve([{ id: FIGLIA }, { id: SORELLA }])
      if (where.ownerUserId) return Promise.resolve([{ id: MADRE }])
      return Promise.resolve([
        { id: MADRE, ragioneSociale: 'Gruppo Madre Srl', parentTenantId: null },
        { id: FIGLIA, ragioneSociale: 'Figlia Alfa Srl', parentTenantId: MADRE },
        { id: SORELLA, ragioneSociale: 'Figlia Beta Srl', parentTenantId: MADRE },
      ])
    })
    const service = creaMembership(prisma, jwtTokens)

    const risposta = await service.listTenants({ id: UTENTE_MADRE, tenantId: MADRE } as any)

    expect(risposta.tenants.map((t: any) => t.id)).toEqual([MADRE, FIGLIA, SORELLA])
    expect(risposta.tenants.find((t: any) => t.id === FIGLIA)!.parentTenantId).toBe(MADRE)
  })

  it('chi e abilitato alla madre ottiene lo switch su una figlia', async () => {
    const prisma = makePrismaGerarchia()
    prisma.user.findUnique = jest
      .fn()
      .mockResolvedValue({ email: 'madre@example.it', fiscalCode: 'CF', role: 'OPERATOR' })
    const service = creaMembership(prisma, jwtTokens)

    const risposta = await service.switchTenant(
      { id: UTENTE_MADRE, tenantId: MADRE, role: 'OPERATOR' } as any,
      FIGLIA
    )

    expect(risposta.tenantId).toBe(FIGLIA)
  })

  it('chi e abilitato a una figlia NON ottiene lo switch sulla sorella', async () => {
    const service = creaMembership(makePrismaGerarchia(), jwtTokens)

    await expect(
      service.switchTenant(
        { id: UTENTE_FIGLIA, tenantId: FIGLIA, role: 'OPERATOR' } as any,
        SORELLA
      )
    ).rejects.toThrow(ForbiddenException)
  })
})

describe('MembershipService — client di sistema per le letture prima di conoscere l’azienda', () => {
  /** Client dell'applicazione: ogni uso fallisce, come farebbe una policy che nasconde la riga. */
  function clientAppProibito() {
    const vieta = () => jest.fn().mockRejectedValue(new Error('client app usato'))
    return {
      tenant: { findFirst: vieta(), findUnique: vieta(), findMany: vieta() },
      consultantTenantAssociation: { findFirst: vieta(), findMany: vieta() },
      user: { findUnique: vieta() },
    } as any
  }

  it('checkAccess: owner, associazione e madre si leggono dal client di sistema, senza contesto', async () => {
    const app = clientAppProibito()
    const sistema = makePrisma({ isActive: true, expiresAt: DOMANI })
    const viste: Array<string | null> = []
    const originale = sistema.consultantTenantAssociation.findFirst
    sistema.consultantTenantAssociation.findFirst = jest.fn((args: any) => {
      viste.push(TenantContext.getStoreTenantId())
      return originale(args)
    })
    const service = new MembershipService(app, sistema, jwtTokens)

    await expect(
      TenantContext.run(
        {},
        async () => await service.checkAccess(UTENTE, TENANT_CLIENTE, TENANT_PRIMARIO)
      )
    ).resolves.toBe(true)

    expect(viste).toEqual([null])
    expect(app.tenant.findFirst).not.toHaveBeenCalled()
    expect(app.consultantTenantAssociation.findFirst).not.toHaveBeenCalled()
  })

  it('checkAccess: la discesa dalla madre legge la figlia dal client di sistema', async () => {
    const app = clientAppProibito()
    const sistema = makePrisma(null)
    sistema.tenant.findUnique = jest.fn().mockResolvedValue({ parentTenantId: null })
    const service = new MembershipService(app, sistema, jwtTokens)

    await expect(service.checkAccess(UTENTE, TENANT_CLIENTE, TENANT_PRIMARIO)).resolves.toBe(false)

    expect(sistema.tenant.findUnique).toHaveBeenCalled()
    expect(app.tenant.findUnique).not.toHaveBeenCalled()
  })

  it('listTenants: aziende e associazioni dal client di sistema', async () => {
    const app = clientAppProibito()
    const sistema = makePrisma(null)
    sistema.consultantTenantAssociation.findMany = jest
      .fn()
      .mockResolvedValue([{ tenantId: TENANT_CLIENTE }])
    sistema.tenant.findMany = jest.fn().mockResolvedValue([])
    const service = new MembershipService(app, sistema, jwtTokens)

    await service.listTenants({ id: UTENTE, tenantId: TENANT_PRIMARIO } as any)

    expect(sistema.consultantTenantAssociation.findMany).toHaveBeenCalled()
    expect(sistema.tenant.findMany).toHaveBeenCalled()
    expect(app.tenant.findMany).not.toHaveBeenCalled()
    expect(app.consultantTenantAssociation.findMany).not.toHaveBeenCalled()
  })

  it('switchTenant: azienda di destinazione e utente dal client di sistema', async () => {
    const app = clientAppProibito()
    const sistema = makePrisma({ isActive: true, expiresAt: DOMANI })
    const service = new MembershipService(app, sistema, jwtTokens)

    const risposta = await service.switchTenant(
      { id: UTENTE, tenantId: TENANT_PRIMARIO, role: 'OPERATOR' } as any,
      TENANT_CLIENTE
    )

    expect(risposta.tenantId).toBe(TENANT_CLIENTE)
    expect(app.tenant.findUnique).not.toHaveBeenCalled()
    expect(app.user.findUnique).not.toHaveBeenCalled()
  })

  it('getActiveCompany: l’azienda attiva e quella del contesto, resta sul client normale', async () => {
    const app = clientAppProibito()
    app.tenant.findUnique = jest
      .fn()
      .mockResolvedValue({ id: TENANT_PRIMARIO, ragioneSociale: 'A Srl', partitaIva: '1' })
    const sistema = makePrisma(null)
    const service = new MembershipService(app, sistema, jwtTokens)

    await service.getActiveCompany(TENANT_PRIMARIO)

    expect(app.tenant.findUnique).toHaveBeenCalled()
    expect(sistema.tenant.findUnique).not.toHaveBeenCalled()
  })
})
