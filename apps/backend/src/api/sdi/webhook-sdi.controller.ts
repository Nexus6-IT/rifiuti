/**
 * Webhook SDI (4.5c): rotta PUBBLICA, senza utente. L'azienda si ricava dal token nell'URL (hash
 * confrontato col database), la firma la verifica l'adattatore del provider. Le risposte non
 * riportano mai dati dell'azienda: 404 generico (token, provider o modulo non validi), 401 generico
 * (firma, timestamp o formato), 200 `{ ricevuto: true }` anche per un evento gia' consegnato.
 * Il raw body serve per l'HMAC: `rawBody: true` e' attivo in `main.ts` (`req.rawBody`).
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request } from 'express'
import { WebhookSdiService } from '../../application/sdi/webhook-sdi.service'
import { Public } from '../../auth/decorators/public.decorator'
import { LimiteWebhookSdi, ThrottlerWebhookSdiGuard } from './throttler-webhook-sdi.guard'

@ApiTags('sdi')
@Controller('sdi/webhook')
@SkipThrottle({ short: true, medium: true, long: true })
export class WebhookSdiController {
  private readonly logger = new Logger(WebhookSdiController.name)

  constructor(private readonly webhook: WebhookSdiService) {}

  @Public()
  @Post(':provider/:token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerWebhookSdiGuard)
  @LimiteWebhookSdi()
  @ApiOperation({ summary: 'Riceve una notifica dal provider SDI (pubblica, token + firma)' })
  async ricevi(
    @Param('provider') provider: string,
    @Param('token') token: string,
    @Req() req: RawBodyRequest<Request>
  ) {
    const corpo = req.rawBody
    if (!Buffer.isBuffer(corpo) || corpo.length === 0) throw new NotFoundException()
    const intestazioni: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') intestazioni[k.toLowerCase()] = v
    }
    let esito
    try {
      esito = await this.webhook.ricevi(provider, token, intestazioni, corpo)
    } catch (err) {
      // Solo il tipo dell'errore: il messaggio del driver puo' riportare i parametri della query.
      this.logger.warn(`Webhook SDI non elaborabile: ${(err as Error).name}`)
      throw new ServiceUnavailableException()
    }
    if (esito.tipo === 'NON_TROVATO') throw new NotFoundException()
    if (esito.tipo === 'NON_AUTENTICO') throw new UnauthorizedException()
    return { ricevuto: true }
  }
}
