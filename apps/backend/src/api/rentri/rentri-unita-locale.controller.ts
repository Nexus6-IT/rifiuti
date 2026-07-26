/**
 * RENTRI Unità Locale Controller — REST API
 *
 * Gestisce le unità locali (sedi operative) RENTRI del tenant corrente
 * (R2 multi-sede). A differenza del certificato (uno per tenant), un tenant
 * può avere più unità locali: chi ne ha una sola non deve scegliere nulla,
 * chi ne ha più d'una sceglie esplicitamente quale è la principale.
 *
 * SICUREZZA: ogni operazione su un id verifica che l'unità locale appartenga
 * al tenant del chiamante. Un id di un altro tenant risulta 404 (mai 403):
 * nessuna fuga di esistenza.
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import {
  RentriUnitaLocaleService,
  RentriUnitaLocale,
} from '../../infrastructure/rentri/rentri-unita-locale.service'
import { CreateRentriUnitaLocaleDto } from './dto/create-rentri-unita-locale.dto'
import { UpdateRentriUnitaLocaleDto } from './dto/update-rentri-unita-locale.dto'

@ApiTags('rentri')
@ApiBearerAuth()
// Global prefix is `api/v1` (vedi main.ts), quindi il path completo è
// `api/v1/rentri/unita-locali`.
@Controller('rentri/unita-locali')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RentriUnitaLocaleController {
  constructor(private readonly service: RentriUnitaLocaleService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Elenca le unità locali RENTRI del tenant corrente' })
  @ApiResponse({ status: 200, description: 'Elenco unità locali' })
  async list(@CurrentUser() user: CurrentUserPayload): Promise<{ items: RentriUnitaLocale[] }> {
    const items = await this.service.listForTenant(user.tenantId)
    return { items }
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea una nuova unità locale RENTRI per il tenant corrente',
    description:
      "La prima sede del tenant diventa principale automaticamente. Dalla seconda in poi, 'principale' è una scelta esplicita.",
  })
  @ApiResponse({ status: 201, description: 'Unità locale creata' })
  @ApiResponse({ status: 400, description: 'numIscrSito non valido o duplicato per il tenant' })
  async create(
    @Body() dto: CreateRentriUnitaLocaleDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<RentriUnitaLocale> {
    return this.service.create(user.tenantId, dto)
  }

  @Put(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aggiorna denominazione/stato di attività di una unità locale' })
  @ApiResponse({ status: 200, description: 'Unità locale aggiornata' })
  @ApiResponse({ status: 404, description: 'Unità locale non trovata' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRentriUnitaLocaleDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<RentriUnitaLocale> {
    return this.service.update(user.tenantId, id, dto)
  }

  @Put(':id/principale')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rende questa unità locale la sede principale del tenant' })
  @ApiResponse({ status: 200, description: 'Sede principale aggiornata' })
  @ApiResponse({ status: 404, description: 'Unità locale non trovata' })
  async setPrincipale(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<RentriUnitaLocale> {
    return this.service.setPrincipale(user.tenantId, id)
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Rimuove una unità locale RENTRI del tenant corrente' })
  @ApiResponse({ status: 204, description: 'Unità locale rimossa' })
  @ApiResponse({ status: 404, description: 'Unità locale non trovata' })
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload): Promise<void> {
    await this.service.remove(user.tenantId, id)
  }
}
