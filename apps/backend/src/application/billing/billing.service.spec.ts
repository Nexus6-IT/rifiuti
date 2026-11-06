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
import { Prisma, SubscriptionStatus, SubscriptionTier } from '@prisma/client'
import { BillingService } from './billing.service'
import { StripeService } from './stripe.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { ContrattoGruppoService } from './contratto-gruppo.service'

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
    parentTenantId: string | null
  }> = {}
) {
  return {
    id: 'tenant-uuid-1',
    parentTenantId: null,
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
        // Servizio reale sul Prisma finto: e' lui a stabilire chi e' la radice
        // del gruppo, regola che questi test verificano.
        ContrattoGruppoService,
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

    it('una figlia vede il piano del gruppo, non il proprio', async () => {
      // Prima lettura: la figlia (per risolvere la radice). Seconda: la madre.
      ;(mockPrisma.tenant.findUnique as jest.Mock)
        .mockResolvedValueOnce(
          makeTenant({
            subscriptionTier: SubscriptionTier.TRIAL,
            parentTenantId: 'tenant-madre-uuid',
          })
        )
        .mockResolvedValueOnce(
          makeTenant({
            subscriptionTier: SubscriptionTier.ENTERPRISE,
            subscriptionStatus: SubscriptionStatus.ACTIVE,
          })
        )

      const result = await service.getStatus('tenant-figlia-uuid')

      expect(result.tier).toBe(SubscriptionTier.ENTERPRISE)
      expect(result.status).toBe(SubscriptionStatus.ACTIVE)
    })
  })

  // ── createBillingPortalSession ────────────────────────────────────────────

  describe('createBillingPortalSession', () => {
    it('una figlia non puo aprire il portale: si gestisce dalla madre', async () => {
      Object.defineProperty(mockStripeService, 'isEnabled', { value: true, writable: true })
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(
        makeTenant({ parentTenantId: 'tenant-madre-uuid' })
      )

      await expect(
        service.createBillingPortalSession('tenant-figlia-uuid', 'https://app.test')
      ).rejects.toThrow("L'abbonamento si gestisce dall'azienda madre del gruppo")

      expect(mockStripeService.createBillingPortalSession).not.toHaveBeenCalled()
    })

    it('una radice apre il portale come prima', async () => {
      Object.defineProperty(mockStripeService, 'isEnabled', { value: true, writable: true })
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(
        makeTenant({ stripeCustomerId: 'cus_test123' })
      )
      ;(mockStripeService.createBillingPortalSession as jest.Mock).mockResolvedValue(
        'https://billing.stripe.com/test'
      )

      const result = await service.createBillingPortalSession('tenant-uuid-1', 'https://app.test')

      expect(result).toBe('https://billing.stripe.com/test')
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

    it('una figlia non puo avviare un checkout: si paga dalla madre', async () => {
      Object.defineProperty(mockStripeService, 'isEnabled', { value: true, writable: true })
      // Tenant figlia: parentTenantId valorizzato → non e' la radice del gruppo.
      ;(mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(
        makeTenant({ parentTenantId: 'tenant-madre-uuid' })
      )

      await expect(
        service.createCheckoutSession('tenant-figlia-uuid', 'PROFESSIONAL', 'https://app.test')
      ).rejects.toThrow("L'abbonamento si gestisce dall'azienda madre del gruppo")

      expect(mockStripeService.createCheckoutSession).not.toHaveBeenCalled()
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled()
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

  describe('cambio di piano: moduli aggiunti e tolti', () => {
    it('subscription.updated azzera featureFlags e featureTolte', async () => {
      const tenant = makeTenant({ stripeCustomerId: 'cus_test123' })
      ;(mockPrisma.tenant.findFirst as jest.Mock).mockResolvedValue(tenant)
      ;(mockPrisma.tenant.update as jest.Mock).mockResolvedValue({})

      await service.processWebhookEvent({
        id: 'evt_sub_updated_moduli',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test',
            customer: 'cus_test123',
            status: 'active',
            current_period_end: 0,
            items: { data: [] },
            metadata: {},
          },
        },
      } as any)

      const [{ data }] = (mockPrisma.tenant.update as jest.Mock).mock.calls[0]
      expect(data.featureFlags).toBe(Prisma.DbNull)
      expect(data.featureTolte).toBe(Prisma.DbNull)
    })

    it('subscription.deleted azzera featureFlags e featureTolte', async () => {
      const tenant = makeTenant({
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test',
      })
      ;(mockPrisma.tenant.findFirst as jest.Mock).mockResolvedValue(tenant)
      ;(mockPrisma.tenant.update as jest.Mock).mockResolvedValue({})

      await service.processWebhookEvent({
        id: 'evt_sub_deleted_moduli',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test',
            customer: 'cus_test123',
            status: 'canceled',
            items: { data: [] },
          },
        },
      } as any)

      const [{ data }] = (mockPrisma.tenant.update as jest.Mock).mock.calls[0]
      expect(data.featureFlags).toBe(Prisma.DbNull)
      expect(data.featureTolte).toBe(Prisma.DbNull)
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
