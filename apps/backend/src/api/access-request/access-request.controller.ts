/**
 * AccessRequestController — endpoint pubblico "Richiedi accesso" (lead capture).
 *
 * Endpoint: POST /api/v1/auth/access-request
 * Accesso: pubblico (no JWT, no autenticazione)
 * Rate limit: 5 req/min per IP (anti-abuso), come il vecchio signup.
 *
 * NON crea tenant/utente: persiste una richiesta e notifica l'admin. La prova
 * guidata (TRIAL) viene attivata manualmente dal consulente (white-glove).
 */

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Public } from '../../auth/decorators/public.decorator'
import { AccessRequestService } from '../../application/access-request/access-request.service'
import { AccessRequestDto } from './dto/access-request.dto'

@Controller('auth')
export class AccessRequestController {
  constructor(private readonly accessRequestService: AccessRequestService) {}

  @Post('access-request')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  async submit(@Body() dto: AccessRequestDto) {
    return this.accessRequestService.submit(dto)
  }
}
