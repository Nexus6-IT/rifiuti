import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/persistence/prisma.module';
import { StripeService } from './stripe.service';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionEnforcementService } from './subscription-enforcement.service';

/**
 * BillingModule — apparato commerciale SaaS (WS-F).
 *
 * Esporta SubscriptionEnforcementService per uso in altri moduli
 * (FIRModule, AdminUserModule) che applicano i limiti di piano.
 *
 * ATTIVARE: configurare in .env:
 *   STRIPE_SECRET_KEY=sk_live_...
 *   STRIPE_WEBHOOK_SECRET=whsec_...
 *   STRIPE_PRICE_ID_PROFESSIONAL=price_...
 *   STRIPE_PRICE_ID_ENTERPRISE=price_...
 *   FRONTEND_URL=https://rifiuti.ignicraft.com
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [BillingController],
  providers: [StripeService, BillingService, SubscriptionEnforcementService],
  exports: [SubscriptionEnforcementService, BillingService, StripeService],
})
export class BillingModule {}
