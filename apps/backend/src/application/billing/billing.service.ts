/**
 * BillingService — logica di business per il billing SaaS.
 *
 * Gestisce:
 *  - Creazione sessioni checkout/portal Stripe
 *  - Aggiornamento dello stato di abbonamento del tenant
 *  - Processing degli eventi webhook (idempotente via Redis)
 *
 * ATTIVARE: impostare STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET e i
 * STRIPE_PRICE_ID_* in .env di produzione.
 */

import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SubscriptionStatus, SubscriptionTier, Prisma } from '@prisma/client'
import Stripe from 'stripe'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { StripeService } from './stripe.service'

/** Mapping Stripe Price ID → SubscriptionTier. Letto dai parametri env. */
export interface PlanPriceMapping {
  priceId: string
  tier: SubscriptionTier
}

/** DTO risposta stato abbonamento per GET /billing/status */
export interface BillingStatusDto {
  tier: SubscriptionTier
  status: SubscriptionStatus
  subscriptionEnd: Date | null
  firLimitPerMonth: number
  userLimitTotal: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  /** URL del Billing Portal Stripe per gestione self-service. Null se Stripe non abilitato. */
  portalUrl?: string | null
  /** true se STRIPE_SECRET_KEY è configurata lato backend (pagamenti attivi). */
  stripeConfigured: boolean
  /** true se Stripe NON è configurato: la UI mostra il banner "modalità test" e disabilita gli upgrade. */
  testMode: boolean
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name)

  /** ID prezzi Stripe per piano, configurati via env. */
  private readonly priceIds: Record<string, SubscriptionTier>

  /** IDs eventi webhook già processati: Map<eventId, timestamp>.
   *  In-memory: sufficiente per test mode single-instance.
   *  ATTIVARE: sostituire con Redis SET per ambienti multi-istanza.
   */
  private readonly processedEvents = new Map<string, Date>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly config: ConfigService
  ) {
    // Costruisce il mapping priceId→tier dai parametri env.
    this.priceIds = {}
    const professionalPriceId = this.config.get<string>('STRIPE_PRICE_ID_PROFESSIONAL')
    const enterprisePriceId = this.config.get<string>('STRIPE_PRICE_ID_ENTERPRISE')
    if (professionalPriceId) {
      this.priceIds[professionalPriceId] = SubscriptionTier.PROFESSIONAL
    }
    if (enterprisePriceId) {
      this.priceIds[enterprisePriceId] = SubscriptionTier.ENTERPRISE
    }
  }

  /**
   * Recupera lo stato di abbonamento corrente del tenant.
   */
  async getStatus(tenantId: string): Promise<BillingStatusDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionEnd: true,
        firLimitPerMonth: true,
        userLimitTotal: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        pec: true,
        ragioneSociale: true,
      },
    })

    if (!tenant) {
      throw new NotFoundException('Tenant non trovato')
    }

    return {
      tier: tenant.subscriptionTier,
      status: tenant.subscriptionStatus,
      subscriptionEnd: tenant.subscriptionEnd,
      firLimitPerMonth: tenant.firLimitPerMonth,
      userLimitTotal: tenant.userLimitTotal,
      stripeCustomerId: tenant.stripeCustomerId,
      stripeSubscriptionId: tenant.stripeSubscriptionId,
      stripeConfigured: this.stripeService.isEnabled,
      testMode: !this.stripeService.isEnabled,
    }
  }

  /**
   * Crea una Stripe Checkout Session per l'upgrade al piano indicato.
   * Salva il customerId se è la prima volta.
   *
   * @param tenantId  - ID del tenant che vuole effettuare l'upgrade.
   * @param planTier  - Piano desiderato (PROFESSIONAL | ENTERPRISE).
   * @param baseUrl   - URL base dell'app frontend (per success/cancel URL).
   * @returns URL della pagina di checkout Stripe, o null se Stripe non abilitato.
   */
  async createCheckoutSession(
    tenantId: string,
    planTier: 'PROFESSIONAL' | 'ENTERPRISE',
    baseUrl: string
  ): Promise<string | null> {
    if (!this.stripeService.isEnabled) {
      this.logger.warn(
        'createCheckoutSession: Stripe non abilitato (no-op). ATTIVARE: STRIPE_SECRET_KEY'
      )
      return null
    }

    const priceEnvKey =
      planTier === 'PROFESSIONAL' ? 'STRIPE_PRICE_ID_PROFESSIONAL' : 'STRIPE_PRICE_ID_ENTERPRISE'
    const priceId = this.config.get<string>(priceEnvKey)

    if (!priceId) {
      throw new BadRequestException(
        `${priceEnvKey} non configurato. ATTIVARE: impostare l'ID prezzo in .env`
      )
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        stripeCustomerId: true,
        pec: true,
        ragioneSociale: true,
        subscriptionStatus: true,
      },
    })

    if (!tenant) {
      throw new NotFoundException('Tenant non trovato')
    }

    if (tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
      throw new ForbiddenException(
        "Account sospeso. Contatta il supporto per riattivare l'abbonamento."
      )
    }

    // Crea o recupera il Customer Stripe.
    const customerId = await this.stripeService.getOrCreateCustomer(tenantId, {
      stripeCustomerId: tenant.stripeCustomerId,
      email: tenant.pec ?? undefined,
      name: tenant.ragioneSociale,
    })

    // Salva il customerId se è la prima volta.
    if (!tenant.stripeCustomerId) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeCustomerId: customerId },
      })
    }

    const checkoutUrl = await this.stripeService.createCheckoutSession({
      customerId,
      priceId,
      tenantId,
      successUrl: `${baseUrl}/abbonamento?success=1`,
      cancelUrl: `${baseUrl}/abbonamento?cancelled=1`,
    })

    this.logger.log(`Checkout session creata per tenant ${tenantId} → piano ${planTier}`)
    return checkoutUrl
  }

  /**
   * Crea una Billing Portal Session per la gestione self-service.
   * @returns URL del Billing Portal Stripe, o null se Stripe non abilitato.
   */
  async createBillingPortalSession(tenantId: string, baseUrl: string): Promise<string | null> {
    if (!this.stripeService.isEnabled) {
      this.logger.warn('createBillingPortalSession: Stripe non abilitato (no-op)')
      return null
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeCustomerId: true },
    })

    if (!tenant?.stripeCustomerId) {
      throw new BadRequestException(
        'Nessun abbonamento Stripe attivo. Effettua prima un upgrade del piano.'
      )
    }

    return this.stripeService.createBillingPortalSession({
      customerId: tenant.stripeCustomerId,
      returnUrl: `${baseUrl}/abbonamento`,
    })
  }

  /**
   * Processa un evento webhook Stripe.
   * Idempotente: gli eventi già processati vengono ignorati.
   *
   * Eventi gestiti:
   *  - checkout.session.completed
   *  - customer.subscription.updated
   *  - customer.subscription.deleted
   *  - invoice.payment_failed
   *  - invoice.payment_succeeded
   */
  async processWebhookEvent(event: Stripe.Event): Promise<void> {
    // Idempotenza: ignora eventi già processati.
    if (this.processedEvents.has(event.id)) {
      this.logger.log(`Evento webhook ${event.id} già processato — ignorato`)
      return
    }
    // Marca come processato (con timestamp per pulizia periodica).
    this.processedEvents.set(event.id, new Date())
    // Pulizia eventi più vecchi di 25 ore (oltre la finestra di retry Stripe).
    this.evictOldEvents()

    this.logger.log(`Processing webhook Stripe: ${event.type} (id=${event.id})`)

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
          break
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
          break
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
          break
        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object as Stripe.Invoice)
          break
        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice)
          break
        default:
          this.logger.log(`Evento Stripe non gestito: ${event.type}`)
      }
    } catch (error) {
      // Rimuovi dall'idempotency cache così che venga ritentato.
      this.processedEvents.delete(event.id)
      this.logger.error(`Errore processing webhook ${event.id}:`, error)
      throw error
    }
  }

  // ─── Handler eventi webhook ──────────────────────────────────────────────

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const tenantId = session.metadata?.tenantId
    if (!tenantId) {
      this.logger.warn('checkout.session.completed: tenantId assente nel metadata')
      return
    }

    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id

    if (!subscriptionId) {
      this.logger.warn('checkout.session.completed: subscriptionId assente')
      return
    }

    // Recupera i dettagli dell'abbonamento per determinare il piano.
    // Non possiamo usare il Stripe client qui direttamente; usiamo il priceId
    // dal subscription recuperato via evento subscription.updated (che arriva
    // quasi in contemporanea). Come fallback usiamo il line_item dalla sessione.
    const planTier = await this.resolveTierFromCheckoutSession(session)

    await this.updateTenantSubscription(tenantId, {
      stripeSubscriptionId: subscriptionId,
      tier: planTier ?? SubscriptionTier.PROFESSIONAL,
      status: SubscriptionStatus.ACTIVE,
    })

    this.logger.log(
      `Abbonamento attivato: tenant=${tenantId} tier=${planTier} sub=${subscriptionId}`
    )
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const tenantId = subscription.metadata?.tenantId
    if (!tenantId) {
      // Fallback: cerca per customerId.
      const tenant = await this.findTenantByCustomerId(
        typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
      )
      if (!tenant) {
        this.logger.warn('subscription.updated: tenant non trovato')
        return
      }
      await this.applySubscriptionUpdate(tenant.id, subscription)
      return
    }
    await this.applySubscriptionUpdate(tenantId, subscription)
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

    const tenant = await this.findTenantByCustomerId(customerId)
    if (!tenant) {
      this.logger.warn('subscription.deleted: tenant non trovato per customerId', customerId)
      return
    }

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: SubscriptionStatus.EXPIRED,
        subscriptionTier: SubscriptionTier.TRIAL,
        stripeSubscriptionId: null,
        subscriptionEnd: new Date(),
        // Ripristina le feature al piano TRIAL (null = derivate dal piano, non override fisso)
        featureFlags: Prisma.DbNull,
        firLimitPerMonth: 10,
        userLimitTotal: 2,
      },
    })

    this.logger.log(`Abbonamento cancellato: tenant=${tenant.id} → declassato a TRIAL/EXPIRED`)
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
    if (!customerId) return

    const tenant = await this.findTenantByCustomerId(customerId)
    if (!tenant) return

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { subscriptionStatus: SubscriptionStatus.SUSPENDED },
    })

    this.logger.warn(`Pagamento fallito: tenant=${tenant.id} → SUSPENDED`)
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
    if (!customerId) return

    const tenant = await this.findTenantByCustomerId(customerId)
    if (!tenant) return

    // Ripristina ACTIVE se era SUSPENDED (pagamento risolto).
    if (tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { subscriptionStatus: SubscriptionStatus.ACTIVE },
      })
      this.logger.log(`Pagamento riuscito: tenant=${tenant.id} → ACTIVE`)
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private async applySubscriptionUpdate(
    tenantId: string,
    subscription: Stripe.Subscription
  ): Promise<void> {
    const priceId = subscription.items?.data[0]?.price?.id
    const tier = priceId
      ? (this.priceIds[priceId] ?? SubscriptionTier.PROFESSIONAL)
      : SubscriptionTier.PROFESSIONAL

    const status = this.mapStripeStatus(subscription.status)
    const subscriptionEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null

    await this.updateTenantSubscription(tenantId, {
      stripeSubscriptionId: subscription.id,
      tier,
      status,
      subscriptionEnd,
    })
  }

  private async updateTenantSubscription(
    tenantId: string,
    params: {
      stripeSubscriptionId?: string
      tier: SubscriptionTier
      status: SubscriptionStatus
      subscriptionEnd?: Date | null
    }
  ): Promise<void> {
    const planLimits = this.getLimitsForTier(params.tier)

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        subscriptionTier: params.tier,
        subscriptionStatus: params.status,
        ...(params.stripeSubscriptionId
          ? { stripeSubscriptionId: params.stripeSubscriptionId }
          : {}),
        ...(params.subscriptionEnd !== undefined
          ? { subscriptionEnd: params.subscriptionEnd }
          : {}),
        // Reset featureFlags a null → si derivano dal piano (fix feature-flag propagation).
        // Non usare override fisso: così i nuovi piani vengono automaticamente applicati.
        featureFlags: Prisma.DbNull,
        firLimitPerMonth: planLimits.firLimitPerMonth,
        userLimitTotal: planLimits.userLimitTotal,
      },
    })
  }

  private getLimitsForTier(tier: SubscriptionTier): {
    firLimitPerMonth: number
    userLimitTotal: number
  } {
    switch (tier) {
      case SubscriptionTier.TRIAL:
        return { firLimitPerMonth: 10, userLimitTotal: 2 }
      case SubscriptionTier.PROFESSIONAL:
        return { firLimitPerMonth: 200, userLimitTotal: 5 }
      case SubscriptionTier.ENTERPRISE:
        return { firLimitPerMonth: 0, userLimitTotal: 0 } // 0 = illimitato
      default:
        return { firLimitPerMonth: 10, userLimitTotal: 2 }
    }
  }

  private mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
    switch (stripeStatus) {
      case 'active':
        return SubscriptionStatus.ACTIVE
      case 'trialing':
        return SubscriptionStatus.TRIAL
      case 'past_due':
      case 'unpaid':
        return SubscriptionStatus.SUSPENDED
      case 'canceled':
      case 'incomplete_expired':
        return SubscriptionStatus.EXPIRED
      default:
        return SubscriptionStatus.ACTIVE
    }
  }

  private async findTenantByCustomerId(customerId: string) {
    return this.prisma.tenant.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true, subscriptionStatus: true },
    })
  }

  /**
   * Risolve il tier dal line_items della Checkout Session.
   * Usato solo in handleCheckoutCompleted come fallback prima che arrivi
   * l'evento subscription.updated.
   */
  private async resolveTierFromCheckoutSession(
    session: Stripe.Checkout.Session
  ): Promise<SubscriptionTier | null> {
    // Il line_items non è espanso di default; usiamo il priceId dal subscription
    // metadata se disponibile, altrimenti null (usecase raro: arriva subito dopo
    // l'evento subscription.created/updated che porta il priceId).
    const lineItems = (session as any).line_items?.data
    if (lineItems && lineItems.length > 0) {
      const priceId = lineItems[0]?.price?.id
      if (priceId && this.priceIds[priceId]) {
        return this.priceIds[priceId]
      }
    }
    return null
  }

  /** Rimuove eventi più vecchi di 25 ore dalla cache idempotenza. */
  private evictOldEvents(): void {
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000)
    for (const [id, ts] of this.processedEvents.entries()) {
      if (ts < cutoff) {
        this.processedEvents.delete(id)
      }
    }
  }
}
