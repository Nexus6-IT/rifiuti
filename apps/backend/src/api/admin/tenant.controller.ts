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
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { TenantService } from '../../application/admin/tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { SetTenantStatusDto } from './dto/set-tenant-status.dto';

/**
 * TenantController (admin)
 *
 * Gestione anagrafica dei tenant — riservata al SUPER_ADMIN.
 * Il prefix globale `api/v1` è applicato a livello di app (NON ripetuto qui),
 * quindi gli endpoint risolvono a `/api/v1/admin/tenants...`.
 *
 * Il modello Tenant non è tenant-scoped (è la tabella tenant stessa): un
 * SUPER_ADMIN può quindi vedere/gestire tutti i tenant della piattaforma.
 */
@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  /**
   * GET /api/v1/admin/tenants
   * Elenca tutti i tenant (ordinati per ragione sociale, con conteggio utenti).
   */
  @Get()
  async list() {
    return this.tenantService.list();
  }

  /**
   * GET /api/v1/admin/tenants/:id
   * Dettaglio di un singolo tenant.
   */
  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.getById(id);
  }

  /**
   * POST /api/v1/admin/tenants
   * Crea un nuovo tenant.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTenantDto) {
    return this.tenantService.create(dto);
  }

  /**
   * PUT /api/v1/admin/tenants/:id
   * Aggiorna un tenant esistente.
   */
  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.tenantService.update(id, dto);
  }

  /**
   * PATCH /api/v1/admin/tenants/:id/status
   * Sospende / riattiva un tenant. Body: { status: 'SUSPENDED' | 'ACTIVE' }.
   */
  @Patch(':id/status')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTenantStatusDto,
  ) {
    return this.tenantService.setStatus(id, dto.status);
  }
}
