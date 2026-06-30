/**
 * BillingService — test unitari
 *
 * Copertura:
 *  - getStatus: restituisce stato corrente del tenant
 *  - createCheckoutSession: no-op se Stripe non abilitato; crea sessione se abilitato
 *  - processWebhookEvent: gestione idempotente degli eventi Stripe
 *  - handlePaymentFailed: sospende il tenant
 *  - handleSubscriptionDeleted: declassa a TRIAL/EXPIRED
 *  - handlePaymentSucceeded: riporta a ACTIVE se era SUSPENDED
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { SubscriptionStatus, SubscriptionTier } from '@prisma/client'
import { BillingService } from './billing.service'
import { StripeService } from './stripe.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaService

const mockStripeService = {
  isEnabled: false,
  getOrCreateCustomer: jest.fn(),
  createCheckoutSession: jest.fn(),
  createBillingPortalSession: jest.fn(),
  constructWebhookEvent: jest.fn(),
} as unknown as StripeService

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      STRIPE_PRICE_ID_PROFESSIONAL: 'price_professional_test',
      STRIPE_PRICE_ID_ENTERPRISE: 'price_enterprise_test',
      FRONTEND_URL: 'https://test.example.com',
    }
    return map[key] ?? undefined
  }),
} as unknown as ConfigService

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTenant(
  overrides: Partial<{
    subscriptionTier: SubscriptionTier
    subscriptionStatus: SubscriptionStatus
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    subscriptionEnd: Date | null
    firLimitPerMonth: number
    userLimitTotal: number
    pec: string | null
    ragioneSociale: string
  }> = {}
) {
  return {
    id: 'tenant-uuid-1',
    subscriptionTier: SubscriptionTier.TRIAL,
    subscriptionStatus: SubscriptionStatus.TRIAL,
    subscriptionEnd: null,
    firLimitPerMonth: 10,
    userLimitTotal: 2,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    pec: 'pec@example.com',
    ragioneSociale: 'Test SRL',
    ...overrides,
  }
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('BillingService', () => {
  let service: BillingService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StripeService, useValue: mockStripeService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    service = module.get<BillingService>(BillingService)
  })

  // ── getStatus ──────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('restituisce lo stato corrente del tenant', async () => {
      const tenant = makeTenant({ subscriptionTier: SubscriptionTier.PROFESSIONAL })
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(tenant)

      const result = await service.getStatus('tenant-uuid-1')

      expect(result.tier).toBe(SubscriptionTier.PROFESSIONAL)
      expect(result.status).toBe(SubscriptionStatus.TRIAL)
    })

    it('lancia NotFoundException se il tenant non esiste', async () => {
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.getStatus('non-esiste')).rejects.toThrow('Tenant non trovato')
    })
  })

  // ── createCheckoutSession ──────────────────────────────────────────────────

  describe('createCheckoutSession', () => {
    it('restituisce null se Stripe non è abilitato (modalità no-op)', async () => {
      Object.defineProperty(mockStripeService, 'isEnabled', { value: false, writable: true })

      const result = await service.createCheckoutSession(
        'tenant-uuid-1',
        'PROFESSIONAL',
        'https://app.example.com'
      )

      expect(result).toBeNull()
    })

    it('crea checkout session e restituisce URL se Stripe è abilitato', async () => {
      Object.defineProperty(mockStripeService, 'isEnabled', { value: true, writable: true })
      const tenant = makeTenant({ subscriptionStatus: SubscriptionStatus.TRIAL })
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(tenant)
      ;(mockStripeService.getOrCreateCustomer as jest.Mock).mockResolvedValue('cus_test123')
      ;(mockPrisma.tenant.update as jest.Mock).mockResolvedValue({
        ...tenant,
        stripeCustomerId: 'cus_test123',
      })
      ;(mockStripeService.createCheckoutSession as jest.Mock).mockResolvedValue(
        'https://checkout.stripe.com/test'
      )

      const result = await service.createCheckoutSession(
        'tenant-uuid-1',
        'PROFESSIONAL',
        'https://app.example.com'
      )

      expect(result).toBe('https://checkout.stripe.com/test')
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cus_test123',
          priceId: 'price_professional_test',
        })
      )
    })

    it('lancia ForbiddenException se il tenant è SUSPENDED', async () => {
      Object.defineProperty(mockStripeService, 'isEnabled', { value: true, writable: true })
      const tenant = makeTenant({ subscriptionStatus: SubscriptionStatus.SUSPENDED })
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(tenant)

      await expect(
        service.createCheckoutSession('tenant-uuid-1', 'PROFESSIONAL', 'https://app.example.com')
      ).rejects.toThrow('Account sospeso')
    })
  })

  // ── processWebhookEvent — idempotenza ────────────────────────────────────

  describe('processWebhookEvent — idempotenza', () => {
    it('ignora un evento già processato (stesso event.id)', async () => {
      const event = {
        id: 'evt_idempotency_test',
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_test',
          },
        },
      } as any

      ;(mockPrisma.tenant.findFirst as jest.Mock).mockResolvedValue(
        makeTenant({ subscriptionStatus: SubscriptionStatus.ACTIVE })
      )
      ;(mockPrisma.tenant.update as jest.Mock).mockResolvedValue({})

      // Prima chiamata: deve essere processata.
      await service.processWebhookEvent(event)
      expect(mockPrisma.tenant.update).toHaveBeenCalledTimes(1)

      jest.clearAllMocks()

      // Seconda chiamata con stesso event.id: deve essere ignorata.
      await service.processWebhookEvent(event)
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled()
    })
  })

  // ── invoice.payment_failed → SUSPENDED ──────────────────────────────────

  describe('invoice.payment_failed', () => {
    it('porta il tenant in stato SUSPENDED', async () => {
      const tenant = makeTenant({ subscriptionStatus: SubscriptionStatus.ACTIVE })
      ;(mockPrisma.tenant.findFirst as jest.Mock).mockResolvedValue(tenant)
      ;(mockPrisma.tenant.update as jest.Mock).mockResolvedValue({})

      const event = {
        id: 'evt_payment_failed_1',
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_test123' } },
      } as any

      await service.processWebhookEvent(event)

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { subscriptionStatus: SubscriptionStatus.SUSPENDED },
        })
      )
    })
  })

  // ── customer.subscription.deleted → EXPIRED/TRIAL ───────────────────────

  describe('customer.subscription.deleted', () => {
    it('declassa il tenant a TRIAL/EXPIRED e azzera i limiti di piano', async () => {
      const tenant = makeTenant({
        subscriptionTier: SubscriptionTier.PROFESSIONAL,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test',
      })
      ;(mockPrisma.tenant.findFirst as jest.Mock).mockResolvedValue(tenant)
      ;(mockPrisma.tenant.update as jest.Mock).mockResolvedValue({})

      const event = {
        id: 'evt_sub_deleted_1',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test',
            customer: 'cus_test123',
            status: 'canceled',
            current_period_end: 0,
            items: { data: [] },
          },
        },
      } as any

      await service.processWebhookEvent(event)

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionStatus: SubscriptionStatus.EXPIRED,
            subscriptionTier: SubscriptionTier.TRIAL,
            stripeSubscriptionId: null,
            firLimitPerMonth: 10,
            userLimitTotal: 2,
          }),
        })
      )
    })
  })

  // ── invoice.payment_succeeded — riattiva se SUSPENDED ───────────────────

  describe('invoice.payment_succeeded', () => {
    it('riporta il tenant a ACTIVE se era SUSPENDED', async () => {
      const tenant = makeTenant({ subscriptionStatus: SubscriptionStatus.SUSPENDED })
      ;(mockPrisma.tenant.findFirst as jest.Mock).mockResolvedValue(tenant)
      ;(mockPrisma.tenant.update as jest.Mock).mockResolvedValue({})

      const event = {
        id: 'evt_payment_succeeded_1',
        type: 'invoice.payment_succeeded',
        data: { object: { customer: 'cus_test123' } },
      } as any

      await service.processWebhookEvent(event)

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { subscriptionStatus: SubscriptionStatus.ACTIVE },
        })
      )
    })

    it('non aggiorna se il tenant è già ACTIVE', async () => {
      const tenant = makeTenant({ subscriptionStatus: SubscriptionStatus.ACTIVE })
      ;(mockPrisma.tenant.findFirst as jest.Mock).mockResolvedValue(tenant)

      const event = {
        id: 'evt_payment_succeeded_2',
        type: 'invoice.payment_succeeded',
        data: { object: { customer: 'cus_test123' } },
      } as any

      await service.processWebhookEvent(event)

      expect(mockPrisma.tenant.update).not.toHaveBeenCalled()
    })
  })
})
