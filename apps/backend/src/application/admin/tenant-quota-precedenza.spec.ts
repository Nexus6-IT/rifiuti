/**
 * Precedenza fra le due quote di creazione azienda (spec §5).
 *
 * «Se il tenant su cui si crea ha `aziendeLimit` valorizzato, comanda quello;
 * altrimenti vale `User.companyLimit` di chi crea.» Le due quote NON si
 * cumulano: un consulente con companyLimit esaurito deve poter continuare a
 * creare figlie dentro un gruppo che ha ancora posti.
 */
import { ForbiddenException } from '@nestjs/common'
import { TenantService } from './tenant.service'

const MADRE = 'tenant-madre-uuid'
const ADMIN = 'utente-admin-uuid'

const dtoBase = {
  partitaIva: '12345678901',
  ragioneSociale: 'Nuova Figlia Srl',
  address: 'Via Roma 1',
  city: 'Roma',
  province: 'RM',
  postalCode: '00100',
}

function makeService(opts: {
  aziendeLimitMadre: number | null
  figlieEsistenti: number
  companyLimit: number
  aziendePossedute: number
}) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === MADRE
            ? { id: MADRE, parentTenantId: null, aziendeLimit: opts.aziendeLimitMadre }
            : null
        )
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      // Due conteggi distinti: le figlie della madre (quota di gruppo) e le
      // aziende possedute dall'utente (quota personale).
      count: jest.fn(({ where }: any) =>
        Promise.resolve(where.parentTenantId ? opts.figlieEsistenti : opts.aziendePossedute)
      ),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'nuovo-uuid', ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ companyLimit: opts.companyLimit }) },
    role: { findUnique: jest.fn().mockResolvedValue({ id: 'ruolo-admin' }) },
    consultantTenantAssociation: { upsert: jest.fn().mockResolvedValue({}) },
  }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const membership: any = { checkAccess: jest.fn().mockResolvedValue(true) }
  return {
    prisma,
    service: new TenantService(prisma, prisma, logger, membership, {
      caricaContratto: jest.fn(),
      caricaContrattiRadici: jest.fn(),
    } as never),
  }
}

const adminCorrente = { id: ADMIN, role: 'ADMIN', tenantId: MADRE } as any

describe('TenantService — precedenza delle quote', () => {
  it('con aziendeLimit sulla madre, il companyLimit esaurito non blocca la figlia', async () => {
    const { service, prisma } = makeService({
      aziendeLimitMadre: 10,
      figlieEsistenti: 3,
      companyLimit: 3,
      aziendePossedute: 3, // quota personale gia' esaurita
    })

    await service.create(adminCorrente, { ...dtoBase, parentTenantId: MADRE } as any)

    expect(prisma.tenant.create).toHaveBeenCalled()
  })

  it('senza aziendeLimit sulla madre, il companyLimit continua a bloccare', async () => {
    const { service, prisma } = makeService({
      aziendeLimitMadre: null,
      figlieEsistenti: 0,
      companyLimit: 3,
      aziendePossedute: 3,
    })

    await expect(
      service.create(adminCorrente, { ...dtoBase, parentTenantId: MADRE } as any)
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(prisma.tenant.create).not.toHaveBeenCalled()
  })

  it('senza madre indicata resta in vigore il solo companyLimit', async () => {
    const { service, prisma } = makeService({
      aziendeLimitMadre: null,
      figlieEsistenti: 0,
      companyLimit: 1,
      aziendePossedute: 1,
    })

    await expect(service.create(adminCorrente, { ...dtoBase } as any)).rejects.toBeInstanceOf(
      ForbiddenException
    )

    expect(prisma.tenant.create).not.toHaveBeenCalled()
  })
})
