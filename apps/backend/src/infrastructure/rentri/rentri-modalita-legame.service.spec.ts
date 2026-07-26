import { BadRequestException } from '@nestjs/common'
import { RentriModalitaLegameService } from './rentri-modalita-legame.service'
import { RentriCredentialService } from './rentri-credential.service'
import { PrismaService } from '../persistence/prisma.service'

describe('RentriModalitaLegameService', () => {
  let service: RentriModalitaLegameService
  let prisma: {
    tenant: { findUniqueOrThrow: jest.Mock; update: jest.Mock }
    fIR: { update: jest.Mock }
  }
  let credentialService: jest.Mocked<Pick<RentriCredentialService, 'hasForTenant'>>

  beforeEach(() => {
    prisma = {
      tenant: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      // Nessun metodo di scrittura sui FIR deve mai essere chiamato da questo
      // servizio: il cambio di modalità non deve retroagire sui formulari già
      // trasmessi/agganciati.
      fIR: { update: jest.fn() },
    }
    credentialService = { hasForTenant: jest.fn() }

    service = new RentriModalitaLegameService(
      prisma as unknown as PrismaService,
      credentialService as unknown as RentriCredentialService
    )
  })

  describe('getForTenant', () => {
    it('ritorna la modalità corrente e se il certificato è configurato', async () => {
      prisma.tenant.findUniqueOrThrow.mockResolvedValue({ rentriModalitaLegame: 'MANUALE' })
      credentialService.hasForTenant.mockResolvedValue(false)

      const res = await service.getForTenant('tenant-1')

      expect(res).toEqual({ modalitaLegame: 'MANUALE', certificatoConfigurato: false })
      expect(prisma.tenant.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        select: { rentriModalitaLegame: true },
      })
    })
  })

  describe('setForTenant', () => {
    it('permette sempre MANUALE, anche senza certificato', async () => {
      credentialService.hasForTenant.mockResolvedValue(false)
      prisma.tenant.update.mockResolvedValue({ rentriModalitaLegame: 'MANUALE' })

      const res = await service.setForTenant('tenant-1', 'MANUALE')

      expect(res).toEqual({ modalitaLegame: 'MANUALE', certificatoConfigurato: false })
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { rentriModalitaLegame: 'MANUALE' },
        select: { rentriModalitaLegame: true },
      })
    })

    it('rifiuta AUTOMATICA senza certificato configurato (400, niente scrittura)', async () => {
      credentialService.hasForTenant.mockResolvedValue(false)

      await expect(service.setForTenant('tenant-1', 'AUTOMATICA')).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.tenant.update).not.toHaveBeenCalled()
    })

    it('rifiuta IBRIDA senza certificato configurato (400, niente scrittura)', async () => {
      credentialService.hasForTenant.mockResolvedValue(false)

      await expect(service.setForTenant('tenant-1', 'IBRIDA')).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.tenant.update).not.toHaveBeenCalled()
    })

    it('permette AUTOMATICA quando il certificato è configurato', async () => {
      credentialService.hasForTenant.mockResolvedValue(true)
      prisma.tenant.update.mockResolvedValue({ rentriModalitaLegame: 'AUTOMATICA' })

      const res = await service.setForTenant('tenant-1', 'AUTOMATICA')

      expect(res).toEqual({ modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true })
    })

    it('permette IBRIDA quando il certificato è configurato', async () => {
      credentialService.hasForTenant.mockResolvedValue(true)
      prisma.tenant.update.mockResolvedValue({ rentriModalitaLegame: 'IBRIDA' })

      const res = await service.setForTenant('tenant-1', 'IBRIDA')

      expect(res).toEqual({ modalitaLegame: 'IBRIDA', certificatoConfigurato: true })
    })

    it('non tocca mai i FIR (nessuna retroattività sui formulari già trasmessi)', async () => {
      credentialService.hasForTenant.mockResolvedValue(true)
      prisma.tenant.update.mockResolvedValue({ rentriModalitaLegame: 'MANUALE' })

      await service.setForTenant('tenant-1', 'MANUALE')
      await service.setForTenant('tenant-1', 'AUTOMATICA')

      expect(prisma.fIR.update).not.toHaveBeenCalled()
    })
  })
})
