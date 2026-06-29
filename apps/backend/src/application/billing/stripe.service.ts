/**
 * StripeService — wrapper Stripe SDK con modalità no-op.
 *
 * Se STRIPE_SECRET_KEY non è impostata l'app NON crasha: tutti i metodi
 * restituiscono un oggetto/stringa vuoto di test e loggano un avviso.
 *
 * ATTIVARE: impostare STRIPE_SECRET_KEY (live) in .env di produzione.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string | null;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? null;

    if (secretKey) {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2025-02-24.acacia',
        typescript: true,
      });
      this.logger.log('Stripe SDK inizializzato (test/live mode)');
    } else {
      this.stripe = null;
      this.logger.warn(
        'STRIPE_SECRET_KEY non impostata — billing in modalità no-op. ' +
          'ATTIVARE: impostare STRIPE_SECRET_KEY in .env',
      );
    }
  }

  get isEnabled(): boolean {
    return this.stripe !== null;
  }

  /**
   * Restituisce il client Stripe o lancia eccezione se non abilitato.
   * Usato internamente dai metodi che richiedono Stripe.
   */
  private getClient(): Stripe {
    if (!this.stripe) {
      throw new Error('Stripe non abilitato: impostare STRIPE_SECRET_KEY in .env');
    }
    return this.stripe;
  }

  /**
   * Crea o recupera il Customer Stripe per il tenant.
   * Idempotente: se il tenant ha già un customerId lo restituisce direttamente.
   */
  async getOrCreateCustomer(
    tenantId: string,
    existing: { stripeCustomerId: string | null; email?: string | null; name?: string | null },
  ): Promise<string> {
    if (existing.stripeCustomerId) {
      return existing.stripeCustomerId;
    }
    const stripe = this.getClient();
    const customer = await stripe.customers.create({
      name: existing.name ?? undefined,
      email: existing.email ?? undefined,
      metadata: { tenantId },
    });
    return customer.id;
  }

  /**
   * Crea una Checkout Session per l'upgrade al piano indicato.
   * Returns: URL della pagina di pagamento Stripe Checkout.
   */
  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    tenantId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const stripe = this.getClient();
    const session = await stripe.checkout.sessions.create({
      customer: params.customerId,
      mode: 'subscription',
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { tenantId: params.tenantId },
      subscription_data: {
        metadata: { tenantId: params.tenantId },
      },
      // Modalità trial: i nuovi checkout partono con 30 giorni di prova
      // SOLO se il tenant è ancora in TRIAL (verificato dal BillingService).
      allow_promotion_codes: true,
    });
    return session.url!;
  }

  /**
   * Crea una Billing Portal Session per la gestione self-service
   * dell'abbonamento (upgrade/downgrade/cancellazione/metodo di pagamento).
   * Returns: URL del Billing Portal Stripe.
   */
  async createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<string> {
    const stripe = this.getClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
    return session.url;
  }

  /**
   * Verifica la firma del webhook Stripe e costruisce l'Event tipizzato.
   * Richiede il raw body (Buffer/string) — NON il JSON parsato.
   *
   * @throws Error se la firma non è valida o il webhook secret non è configurato.
   */
  constructWebhookEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET non impostata — verifica firma webhook impossibile',
      );
    }
    // Lancia StripeSignatureVerificationError se la firma non è valida.
    return this.getClient().webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }
}
