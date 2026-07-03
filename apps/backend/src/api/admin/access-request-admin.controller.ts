/**
 * AccessRequestAdminController — gestione delle richieste di accesso (lead).
 *
 * Prefix globale `api/v1` applicato dall'app → risolve a
 * `/api/v1/admin/access-requests...`.
 *
 * Protezione: JWT + RolesGuard, riservato al SUPER_ADMIN. Le richieste NON sono
 * tenant-scoped (sono lead di potenziali nuovi tenant); il consulente le lavora
 * e attiva eventualmente una prova guidata via /admin/tenants + /admin/utenti.
 */

import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common'
import { AccessRequestStatus } from '@prisma/client'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { AccessRequestService } from '../../application/access-request/access-request.service'
import { UpdateAccessRequestDto } from './dto/update-access-request.dto'

@Controller('admin/access-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AccessRequestAdminController {
  constructor(private readonly accessRequestService: AccessRequestService) {}

  /**
   * GET /api/v1/admin/access-requests?status=PENDING
   * Elenca le richieste di accesso (più recenti prima).
   */
  @Get()
  async list(@Query('status') status?: string) {
    const parsed =
      status && (Object.values(AccessRequestStatus) as string[]).includes(status)
        ? (status as AccessRequestStatus)
        : undefined
    return this.accessRequestService.list(parsed)
  }

  /**
   * PATCH /api/v1/admin/access-requests/:id
   * Aggiorna lo stato di lavorazione (e l'eventuale nota interna).
   */
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccessRequestDto
  ) {
    return this.accessRequestService.updateStatus(id, dto.status, dto.handledNote)
  }
}
