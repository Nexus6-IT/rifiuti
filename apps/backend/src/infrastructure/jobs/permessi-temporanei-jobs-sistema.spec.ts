/**
 * RLS pezzo 2b: i job dei permessi temporanei scansionano tutte le aziende dal client
 * di sistema; la scrittura del singolo permesso gira nel contesto della sua azienda.
 * Il Proxy fornito come PrismaService fa fallire il test se il job tornasse a dipenderne
 * (la garanzia vera e' il costruttore).
 */

import { Test } from '@nestjs/testing'
import { ExpireTempPermissionsJob } from './expire-temp-permissions.job'
import { CleanupOldPermissionRequestsJob } from './cleanup-old-permission-requests.job'
import { PrismaService } from '../persistence/prisma.service'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { PrismaTemporaryPermissionGrantRepository } from '../persistence/temporary-permission-grant.repository'
import { TenantContext } from '../../core/context/tenant-context'

const applicativoVietato = new Proxy(
  {},
  {
    get: () => {
      throw new Error('client applicativo non ammesso per la scansione di tutte le aziende')
    },
  }
)

function grantScaduto(id: string, tenantId: string) {
  return {
    id,
    userId: `u-${tenantId}`,
    tenantId,
    permissions: ['x'],
    isApproved: () => true,
    isActive: () => false,
    revoke: jest.fn(),
  }
}

describe('ExpireTempPermissionsJob — contesto per azienda', () => {
  it('expire-temp-permissions: lavoro di ogni azienda nel suo contesto', async () => {
    const visti: Array<string | null> = []
    const repo = {
      findGrantsNeedingExpiration: jest
        .fn()
        .mockResolvedValue([grantScaduto('g1', 't1'), grantScaduto('g2', 't2')]),
      save: jest.fn(async () => {
        visti.push(TenantContext.getStoreTenantId())
      }),
    }
    const job = new ExpireTempPermissionsJob(repo as never)

    await job.process({} as never)

    expect(visti).toEqual(['t1', 't2'])
  })
})

describe('CleanupOldPermissionRequestsJob — client di sistema', () => {
  it('cleanup-old-permission-requests: elenco delle aziende dal client di sistema', async () => {
    const sistema = { temporaryPermissionGrant: { findMany: jest.fn().mockResolvedValue([]) } }
    const modulo = await Test.createTestingModule({
      providers: [
        CleanupOldPermissionRequestsJob,
        { provide: 'TemporaryPermissionGrantRepository', useValue: {} },
        { provide: PrismaService, useValue: applicativoVietato },
        { provide: PrismaSistemaService, useValue: sistema },
      ],
    }).compile()

    await modulo.get(CleanupOldPermissionRequestsJob).process({} as never)

    expect(sistema.temporaryPermissionGrant.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('PrismaTemporaryPermissionGrantRepository.findGrantsNeedingExpiration', () => {
  function costruisci() {
    const applicativo = { temporaryPermissionGrant: { findMany: jest.fn().mockResolvedValue([]) } }
    const sistema = { temporaryPermissionGrant: { findMany: jest.fn().mockResolvedValue([]) } }
    const repo = new PrismaTemporaryPermissionGrantRepository(
      applicativo as never,
      sistema as never
    )
    return { repo, applicativo, sistema }
  }

  it('temporary-permission-grant: senza azienda la scansione va sul client di sistema', async () => {
    const { repo, applicativo, sistema } = costruisci()

    await repo.findGrantsNeedingExpiration()

    expect(sistema.temporaryPermissionGrant.findMany).toHaveBeenCalledTimes(1)
    expect(applicativo.temporaryPermissionGrant.findMany).not.toHaveBeenCalled()
  })

  it('temporary-permission-grant: con un tenant resta sul client applicativo', async () => {
    const { repo, applicativo, sistema } = costruisci()

    await repo.findGrantsNeedingExpiration('t1')

    expect(applicativo.temporaryPermissionGrant.findMany).toHaveBeenCalledTimes(1)
    expect(sistema.temporaryPermissionGrant.findMany).not.toHaveBeenCalled()
  })
})
