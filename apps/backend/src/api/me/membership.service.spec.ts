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

const jwtTokens = {
  generateTokenPair: () => ({ accessToken: 'a', refreshToken: 'r' }),
} as any

const IERI = new Date(Date.now() - 24 * 60 * 60 * 1000)
const DOMANI = new Date(Date.now() + 24 * 60 * 60 * 1000)

describe('MembershipService — associazione consulente scaduta', () => {
  it('nega checkAccess quando l’associazione è scaduta', async () => {
    const service = new MembershipService(
      makePrisma({ isActive: true, expiresAt: IERI }),
      jwtTokens
    )

    await expect(service.checkAccess(UTENTE, TENANT_CLIENTE, TENANT_PRIMARIO)).resolves.toBe(false)
  })

  it('consente checkAccess con associazione attiva non scaduta', async () => {
    const service = new MembershipService(
      makePrisma({ isActive: true, expiresAt: DOMANI }),
      jwtTokens
    )

    await expect(service.checkAccess(UTENTE, TENANT_CLIENTE, TENANT_PRIMARIO)).resolves.toBe(true)
  })

  it('consente checkAccess con associazione senza scadenza', async () => {
    const service = new MembershipService(
      makePrisma({ isActive: true, expiresAt: null }),
      jwtTokens
    )

    await expect(service.checkAccess(UTENTE, TENANT_CLIENTE, TENANT_PRIMARIO)).resolves.toBe(true)
  })

  it('rifiuta lo switch di azienda su associazione scaduta', async () => {
    const service = new MembershipService(
      makePrisma({ isActive: true, expiresAt: IERI }),
      jwtTokens
    )

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
    const service = new MembershipService(makePrismaGerarchia(), jwtTokens)

    await expect(service.checkAccess(UTENTE_MADRE, FIGLIA, MADRE)).resolves.toBe(true)
  })

  it('chi e abilitato a una figlia NON accede alla sorella', async () => {
    const service = new MembershipService(makePrismaGerarchia(), jwtTokens)

    await expect(service.checkAccess(UTENTE_FIGLIA, SORELLA, FIGLIA)).resolves.toBe(false)
  })

  it('chi e abilitato a una figlia NON risale alla madre', async () => {
    const service = new MembershipService(makePrismaGerarchia(), jwtTokens)

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
    const service = new MembershipService(prisma, jwtTokens)

    const risposta = await service.listTenants({ id: UTENTE_MADRE, tenantId: MADRE } as any)

    expect(risposta.tenants.map((t: any) => t.id)).toEqual([MADRE, FIGLIA, SORELLA])
    expect(risposta.tenants.find((t: any) => t.id === FIGLIA)!.parentTenantId).toBe(MADRE)
  })
})
