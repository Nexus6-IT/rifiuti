/**
 * SignupController — endpoint pubblico di registrazione self-service (WS-G).
 *
 * Endpoint: POST /api/v1/auth/signup
 * Accesso: pubblico (no JWT, no autenticazione)
 * Rate limit: overrideato a 5 req/min per indirizzo IP (anti-abuso)
 */

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Public } from '../../auth/decorators/public.decorator'
import { SignupService } from '../../application/signup/signup.service'
import { SignupDto } from './dto/signup.dto'

@Controller('auth')
export class SignupController {
  constructor(private readonly signupService: SignupService) {}

  /**
   * POST /api/v1/auth/signup
   *
   * Registra una nuova azienda (tenant TRIAL) con il suo utente admin.
   * Crea l'utente su Keycloak con richiesta di verifica email e ritorna
   * un messaggio che invita a controllare la casella di posta.
   *
   * Rate limit: sovrascritta a 5 req/min (medium) per mitigare gli abusi
   * pur mantenendo le protezioni globali (short: 10/s, long: 1000/15min).
   */
  @Post('signup')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  async signup(@Body() dto: SignupDto) {
    return this.signupService.signup(dto)
  }
}
