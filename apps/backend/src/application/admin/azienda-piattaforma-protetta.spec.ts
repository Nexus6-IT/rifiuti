import { BadRequestException } from '@nestjs/common'
import {
  AZIENDA_PIATTAFORMA_ID,
  assertNonPiattaforma,
} from '../../core/context/azienda-piattaforma'
import { TenantService } from './tenant.service'
import { UserAdminService } from './user-admin.service'

const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const superAdmin = { id: 'su', role: 'SUPER_ADMIN', tenantId: 't-casa' } as any

function tenantService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.partitaIva ? null : { id: AZIENDA_PIATTAFORMA_ID, ownerUserId: null }
      ),
      update: jest.fn(),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  }
  return { prisma, service: new TenantService(prisma, {} as any, logger, {} as any) }
}

async function messaggio(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException)
    return (e as Error).message
  }
  throw new Error('atteso un errore')
}

describe('azienda piattaforma non trasformabile in azienda normale', () => {
  it('assertNonPiattaforma: errore senza id; altre aziende passano', async () => {
    const m = await messaggio(async () => assertNonPiattaforma(AZIENDA_PIATTAFORMA_ID))
    expect(m).not.toContain(AZIENDA_PIATTAFORMA_ID)
    expect(() => assertNonPiattaforma('altra')).not.toThrow()
    expect(() => assertNonPiattaforma(undefined)).not.toThrow()
  })

  it('TenantService.create con parentTenantId = piattaforma', async () => {
    const t = tenantService()
    const m = await messaggio(
      async () =>
        await t.service.create(superAdmin, {
          partitaIva: '12345678901',
          ragioneSociale: 'X',
          parentTenantId: AZIENDA_PIATTAFORMA_ID,
        } as any)
    )
    expect(m).not.toContain(AZIENDA_PIATTAFORMA_ID)
    expect(t.prisma.tenant.create).not.toHaveBeenCalled()
  })

  it('TenantService.update sulla piattaforma', async () => {
    const t = tenantService()
    await messaggio(
      async () =>
        await t.service.update(superAdmin, AZIENDA_PIATTAFORMA_ID, { city: 'Roma' } as any)
    )
    expect(t.prisma.tenant.update).not.toHaveBeenCalled()
  })

  it('TenantService.setStatus sulla piattaforma', async () => {
    const t = tenantService()
    await messaggio(async () => await t.service.setStatus(AZIENDA_PIATTAFORMA_ID, 'ACTIVE'))
    expect(t.prisma.tenant.update).not.toHaveBeenCalled()
  })

  it('UserAdminService.createUser con tenantId = piattaforma', async () => {
    const prisma: any = { user: { create: jest.fn() } }
    const service = new UserAdminService(prisma, {} as any, {} as any, logger, {} as any)
    const m = await messaggio(
      async () =>
        await service.createUser(superAdmin, {
          tenantId: AZIENDA_PIATTAFORMA_ID,
          email: 'a@b.it',
          fiscalCode: 'RSSMRA80A01H501U',
        } as any)
    )
    expect(m).not.toContain(AZIENDA_PIATTAFORMA_ID)
  })
})
