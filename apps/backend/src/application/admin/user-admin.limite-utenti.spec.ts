/**
 * Limite utenti dentro un gruppo.
 *
 * Il VALORE del tetto viene dal contratto della madre (una figlia non ha un
 * abbonamento proprio); il CONTEGGIO resta della singola azienda — stessa
 * regola del tetto FIR: una societa' non consuma la quota delle sorelle.
 *
 * Senza questa regola una figlia di un gruppo ENTERPRISE (userLimitTotal = 0,
 * cioe' illimitato sulla radice) restava bloccata al default di schema.
 */
import { ForbiddenException } from '@nestjs/common'
import { UserAdminService } from './user-admin.service'
import { SubscriptionEnforcementService } from '../billing/subscription-enforcement.service'
import { ContrattoGruppoService } from '../billing/contratto-gruppo.service'

const RADICE = 'tenant-madre-uuid'
const FIGLIA = 'tenant-figlia-uuid'

// Codice fiscale valido: la VO di dominio lo verifica prima di toccare Keycloak.
const CF_VALIDO = 'MNZGZN78A01F839X'

function makeService(opts: { userLimitRadice: number; utentiNonAdminFiglia: number }) {
  const rigaRadice = {
    id: RADICE,
    parentTenantId: null,
    subscriptionTier: 'ENTERPRISE',
    subscriptionStatus: 'ACTIVE',
    subscriptionEnd: null,
    firLimitPerMonth: 0,
    userLimitTotal: opts.userLimitRadice,
    featureFlags: null,
    aziendeLimit: 5,
    ragioneSociale: 'Gruppo Madre Srl',
  }
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === RADICE
            ? { ...rigaRadice, madre: null }
            : {
                id: FIGLIA,
                parentTenantId: RADICE,
                subscriptionTier: 'TRIAL',
                subscriptionStatus: 'TRIAL',
                subscriptionEnd: null,
                // Valori della figlia: NON devono comandare.
                firLimitPerMonth: 1,
                userLimitTotal: 2,
                featureFlags: null,
                aziendeLimit: null,
                ragioneSociale: 'Figlia Alfa Srl',
                madre: { ...rigaRadice },
              }
        )
      ),
    },
    user: {
      count: jest.fn(({ where }: any) =>
        Promise.resolve(where.tenantId === FIGLIA ? opts.utentiNonAdminFiglia : 0)
      ),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'nuovo-utente-uuid', ...data })),
    },
  }
  const keycloak: any = {
    createUser: jest.fn().mockResolvedValue('keycloak-uuid'),
    setPassword: jest.fn().mockResolvedValue(undefined),
    disableUser: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const enforcement = new SubscriptionEnforcementService(prisma, new ContrattoGruppoService(prisma))
  return {
    prisma,
    keycloak,
    service: new UserAdminService(prisma, prisma, keycloak, logger, enforcement),
  }
}

const adminFiglia = { id: 'admin-uuid', role: 'ADMIN', tenantId: FIGLIA } as any

const dtoUtente = {
  fiscalCode: CF_VALIDO,
  firstName: 'Mario',
  lastName: 'Rossi',
  email: 'mario.rossi@example.com',
  role: 'OPERATOR',
} as any

describe('UserAdminService — limite utenti di gruppo', () => {
  it('la figlia di un gruppo illimitato (userLimitTotal 0 sulla radice) non viene bloccata', async () => {
    const { service, prisma } = makeService({ userLimitRadice: 0, utentiNonAdminFiglia: 7 })

    await expect(service.createUser(adminFiglia, dtoUtente)).resolves.toEqual(
      expect.objectContaining({ tenantId: FIGLIA })
    )
    expect(prisma.user.create).toHaveBeenCalled()
  })

  it('con un tetto basso sulla radice la creazione nella figlia viene rifiutata', async () => {
    const { service, prisma } = makeService({ userLimitRadice: 2, utentiNonAdminFiglia: 2 })

    await expect(service.createUser(adminFiglia, dtoUtente)).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('il conteggio resta sulla figlia: non si sommano gli utenti delle sorelle', async () => {
    const { service, prisma } = makeService({ userLimitRadice: 5, utentiNonAdminFiglia: 1 })

    await service.createUser(adminFiglia, dtoUtente)

    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: FIGLIA }) })
    )
  })
})
