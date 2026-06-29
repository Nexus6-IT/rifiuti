/**
 * BillingController
 *
 * Endpoint REST per la gestione dell'abbonamento SaaS:
 *  GET  /api/v1/billing/status    — stato corrente abbonamento del tenant
 *  POST /api/v1/billing/checkout  — crea Stripe Checkout Session per upgrade
 *  POST /api/v1/billing/portal    — crea Stripe Billing Portal Session
 *  POST /api/v1/billing/webhook   — endpoint webhook Stripe (raw body, firma verificata)
 *
 * NOTA WEBHOOK: l'endpoint /webhook NON usa il ValidationPipe globale (rawBody)
 * e NON richiede autenticazione JWT (arriva da Stripe, non dal browser).
 * La sicurezza è garantita dalla verifica della firma HMAC-SHA256.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { ConfigService } from '@nestjs/config';

export class CheckoutRequestDto {
  @IsString()
  @IsIn(['PROFESSIONAL', 'ENTERPRISE'])
  plan: 'PROFESSIONAL' | 'ENTERPRISE';
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly stripeService: StripeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * GET /api/v1/billing/status
   * Restituisce lo stato corrente dell'abbonamento del tenant autenticato.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stato abbonamento corrente' })
  async getStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.billingService.getStatus(user.tenantId);
  }

  /**
   * POST /api/v1/billing/checkout
   * Crea una Stripe Checkout Session per l'upgrade del piano.
   * Restituisce l'URL di pagamento Stripe (null se Stripe non è abilitato → test mode).
   */
  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crea sessione checkout Stripe per upgrade piano' })
  async createCheckout(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CheckoutRequestDto,
    @Req() req: Request,
  ) {
    const baseUrl = this.resolveBaseUrl(req);
    const url = await this.billingService.createCheckoutSession(user.tenantId, dto.plan, baseUrl);
    return {
      url,
      testMode: !this.stripeService.isEnabled,
      message: !this.stripeService.isEnabled
        ? 'Stripe non configurato: ATTIVARE impostando STRIPE_SECRET_KEY in .env'
        : undefined,
    };
  }

  /**
   * POST /api/v1/billing/portal
   * Crea una Stripe Billing Portal Session per la gestione self-service.
   */
  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crea sessione Billing Portal Stripe' })
  async createPortal(@CurrentUser() user: CurrentUserPayload, @Req() req: Request) {
    const baseUrl = this.resolveBaseUrl(req);
    const url = await this.billingService.createBillingPortalSession(user.tenantId, baseUrl);
    return {
      url,
      testMode: !this.stripeService.isEnabled,
    };
  }

  /**
   * POST /api/v1/billing/webhook
   * Endpoint webhook Stripe — NON autenticato JWT (arriva da Stripe).
   * Richiede il raw body per la verifica della firma HMAC-SHA256.
   *
   * Sicurezza: verifica della firma via StripeService.constructWebhookEvent.
   * Idempotenza: gestita in BillingService.processWebhookEvent.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook Stripe (firma verificata)' })
  async handleWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ) {
    // Il raw body è disponibile grazie a rawBody: true in NestFactory.create.
    const rawBody: Buffer | undefined = (req as any).rawBody;

    if (!rawBody) {
      this.logger.error(
        'Webhook: rawBody non disponibile. Verificare rawBody:true in NestFactory.',
      );
      return res.status(400).json({ error: 'Raw body non disponibile' });
    }

    if (!signature) {
      return res.status(400).json({ error: 'stripe-signature header mancante' });
    }

    let event: import('stripe').default.Event;
    try {
      event = this.stripeService.constructWebhookEvent(rawBody, signature);
    } catch (err: any) {
      this.logger.warn(`Webhook firma non valida: ${err.message}`);
      return res.status(400).json({ error: `Firma non valida: ${err.message}` });
    }

    try {
      await this.billingService.processWebhookEvent(event);
      return res.status(200).json({ received: true });
    } catch (err: any) {
      this.logger.error(`Errore processing webhook: ${err.message}`, err);
      // Restituisce 500 → Stripe ritenterà l'evento.
      return res.status(500).json({ error: 'Errore interno processing evento' });
    }
  }

  /**
   * Risolve l'URL base del frontend dall'environment o dall'header Origin.
   * Usato per costruire i success/cancel URL del checkout e il return URL del portal.
   */
  private resolveBaseUrl(req: Request): string {
    // Priority: env FRONTEND_URL → Origin header → fallback localhost
    const envUrl = this.config.get<string>('FRONTEND_URL');
    if (envUrl) return envUrl.replace(/\/$/, '');

    const origin = req.headers.origin;
    if (origin) return origin.replace(/\/$/, '');

    return 'http://localhost:4200';
  }
}
