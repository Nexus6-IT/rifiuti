import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { TenantService } from '../../application/admin/tenant.service'
import { CreateTenantDto } from './dto/create-tenant.dto'
import { UpdateTenantDto } from './dto/update-tenant.dto'
import { SetTenantStatusDto } from './dto/set-tenant-status.dto'

/**
 * TenantController (admin)
 *
 * Gestione anagrafica dei tenant — accessibile a SUPER_ADMIN e ADMIN.
 * Il prefix globale `api/v1` è applicato a livello di app (NON ripetuto qui),
 * quindi gli endpoint risolvono a `/api/v1/admin/tenants...`.
 *
 * Il modello Tenant non è tenant-scoped (è la tabella tenant stessa): un
 * SUPER_ADMIN può vedere/gestire tutti i tenant della piattaforma; un ADMIN può
 * creare e gestire SOLO le proprie aziende entro la quota `companyLimit`.
 * Lo scoping fine è applicato nel service a partire da `currentUser`.
 */
@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  /**
   * GET /api/v1/admin/tenants
   * SUPER_ADMIN: tutti i tenant. ADMIN: solo le proprie aziende + il proprio
   * tenant (ordinati per ragione sociale, con conteggio utenti).
   */
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async list(@CurrentUser() currentUser: CurrentUserPayload) {
    return this.tenantService.list(currentUser)
  }

  /**
   * GET /api/v1/admin/tenants/:id
   * Dettaglio di un singolo tenant (solo SUPER_ADMIN).
   */
  @Get(':id')
  @Roles('SUPER_ADMIN')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.getById(id)
  }

  /**
   * POST /api/v1/admin/tenants
   * Crea un nuovo tenant. SUPER_ADMIN imposta piano/feature/limiti; ADMIN crea
   * in self-service entro la quota `companyLimit` (piano forzato a default).
   */
  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() currentUser: CurrentUserPayload, @Body() dto: CreateTenantDto) {
    return this.tenantService.create(currentUser, dto)
  }

  /**
   * PUT /api/v1/admin/tenants/:id
   * Aggiorna un tenant. SUPER_ADMIN: tutto. ADMIN: solo le proprie aziende e
   * solo l'anagrafica (i campi di piano vengono ignorati).
   */
  @Put(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async update(
    @CurrentUser() currentUser: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto
  ) {
    return this.tenantService.update(currentUser, id, dto)
  }

  /**
   * PATCH /api/v1/admin/tenants/:id/status
   * Sospende / riattiva un tenant (solo SUPER_ADMIN).
   * Body: { status: 'SUSPENDED' | 'ACTIVE' }.
   */
  @Patch(':id/status')
  @Roles('SUPER_ADMIN')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTenantStatusDto) {
    return this.tenantService.setStatus(id, dto.status)
  }
}
