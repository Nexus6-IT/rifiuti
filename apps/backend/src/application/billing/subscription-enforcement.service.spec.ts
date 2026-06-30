/**
 * SubscriptionEnforcementService — test unitari
 *
 * Verifica:
 *  - assertNotSuspended: blocca SUSPENDED, EXPIRED, scaduto; passa ACTIVE/TRIAL
 *  - assertFirLimitNotReached: blocca se count >= limite; passa se sotto limite
 *  - assertUserLimitNotReached: blocca se count >= limite; bypassa ADMIN/SUPER_ADMIN
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ForbiddenException } from '@nestjs/common'
import { SubscriptionStatus, SubscriptionTier } from '@prisma/client'
import { SubscriptionEnforcementService } from './subscription-enforcement.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

// ── Mock PrismaService ────────────────────────────────────────────────────

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  fIR: {
    count: jest.fn(),
  },
  user: {
    count: jest.fn(),
  },
} as unknown as PrismaService

// ── Test suite ─────────────────────────────────────────────────────────────

describe('SubscriptionEnforcementService', () => {
  let service: SubscriptionEnforcementService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [SubscriptionEnforcementService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile()

    service = module.get<SubscriptionEnforcementService>(SubscriptionEnforcementService)
  })

  // ── assertNotSuspended ─────────────────────────────────────────────────────

  describe('assertNotSuspended', () => {
    it('non lancia per tenant ACTIVE', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEnd: null,
      })

      await expect(service.assertNotSuspended('tenant-1')).resolves.toBeUndefined()
    })

    it('non lancia per tenant TRIAL', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        subscriptionStatus: SubscriptionStatus.TRIAL,
        subscriptionEnd: null,
      })

      await expect(service.assertNotSuspended('tenant-1')).resolves.toBeUndefined()
    })

    it('lancia ForbiddenException per tenant SUSPENDED', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        subscriptionStatus: SubscriptionStatus.SUSPENDED,
        subscriptionEnd: null,
      })

      await expect(service.assertNotSuspended('tenant-1')).rejects.toThrow(ForbiddenException)
      await expect(service.assertNotSuspended('tenant-1')).rejects.toThrow('sospeso')
    })

    it('lancia ForbiddenException per tenant EXPIRED', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        subscriptionStatus: SubscriptionStatus.EXPIRED,
        subscriptionEnd: null,
      })

      await expect(service.assertNotSuspended('tenant-1')).rejects.toThrow(ForbiddenException)
      await expect(service.assertNotSuspended('tenant-1')).rejects.toThrow('scaduto')
    })

    it('lancia ForbiddenException per tenant ACTIVE con subscriptionEnd nel passato', async () => {
      const passato = new Date(Date.now() - 1000 * 60 * 60 * 24) // ieri
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEnd: passato,
      })

      await expect(service.assertNotSuspended('tenant-1')).rejects.toThrow(ForbiddenException)
      await expect(service.assertNotSuspended('tenant-1')).rejects.toThrow('scaduto')
    })

    it('non lancia per tenant ACTIVE con subscriptionEnd nel futuro', async () => {
      const futuro = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) // +30 giorni
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEnd: futuro,
      })

      await expect(service.assertNotSuspended('tenant-1')).resolves.toBeUndefined()
    })

    it('non lancia se il tenant non esiste (gestito da RLS)', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.assertNotSuspended('non-esiste')).resolves.toBeUndefined()
    })
  })

  // ── assertFirLimitNotReached ───────────────────────────────────────────────

  describe('assertFirLimitNotReached', () => {
    it('non lancia se count < limite mensile', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        firLimitPerMonth: 10,
        subscriptionTier: SubscriptionTier.TRIAL,
      })
      ;(mockPrisma.fIR.count as jest.Mock).mockResolvedValue(5)

      await expect(service.assertFirLimitNotReached('tenant-1')).resolves.toBeUndefined()
    })

    it('lancia ForbiddenException se count >= limite mensile', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        firLimitPerMonth: 10,
        subscriptionTier: SubscriptionTier.TRIAL,
      })
      ;(mockPrisma.fIR.count as jest.Mock).mockResolvedValue(10)

      await expect(service.assertFirLimitNotReached('tenant-1')).rejects.toThrow(ForbiddenException)
      await expect(service.assertFirLimitNotReached('tenant-1')).rejects.toThrow(
        'Limite mensile FIR raggiunto'
      )
    })

    it('non lancia se firLimitPerMonth = 0 (ENTERPRISE, illimitato)', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        firLimitPerMonth: 0,
        subscriptionTier: SubscriptionTier.ENTERPRISE,
      })

      // Nessuna chiamata al count necessaria
      await expect(service.assertFirLimitNotReached('tenant-1')).resolves.toBeUndefined()
      expect(mockPrisma.fIR.count).not.toHaveBeenCalled()
    })

    it('esclude i FIR CANCELLED dal conteggio mensile', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        firLimitPerMonth: 10,
        subscriptionTier: SubscriptionTier.TRIAL,
      })
      ;(mockPrisma.fIR.count as jest.Mock).mockResolvedValue(3)

      await service.assertFirLimitNotReached('tenant-1')

      // Verifica che il count escluda CANCELLED
      expect(mockPrisma.fIR.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: 'CANCELLED' },
          }),
        })
      )
    })
  })

  // ── assertUserLimitNotReached ──────────────────────────────────────────────

  describe('assertUserLimitNotReached', () => {
    it('non lancia se count < limite utenti', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({ userLimitTotal: 5 })
      ;(mockPrisma.user.count as jest.Mock).mockResolvedValue(3)

      await expect(
        service.assertUserLimitNotReached('tenant-1', 'OPERATOR')
      ).resolves.toBeUndefined()
    })

    it('lancia ForbiddenException se count >= limite utenti', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({ userLimitTotal: 5 })
      ;(mockPrisma.user.count as jest.Mock).mockResolvedValue(5)

      await expect(service.assertUserLimitNotReached('tenant-1', 'OPERATOR')).rejects.toThrow(
        ForbiddenException
      )
    })

    it('non controlla il limite per il ruolo ADMIN', async () => {
      await service.assertUserLimitNotReached('tenant-1', 'ADMIN')

      expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled()
      expect(mockPrisma.user.count).not.toHaveBeenCalled()
    })

    it('non controlla il limite per il ruolo SUPER_ADMIN', async () => {
      await service.assertUserLimitNotReached('tenant-1', 'SUPER_ADMIN')

      expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled()
    })

    it('userLimitTotal = 0 non blocca mai (illimitato)', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({ userLimitTotal: 0 })
      ;(mockPrisma.user.count as jest.Mock).mockResolvedValue(999)

      await expect(
        service.assertUserLimitNotReached('tenant-1', 'OPERATOR')
      ).resolves.toBeUndefined()
    })
  })
})
