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
