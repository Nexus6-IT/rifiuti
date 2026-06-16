/**
 * UserAdminController
 *
 * API REST per la gestione utenti in-app (con provisioning Keycloak).
 * Prefix globale `api/v1` applicato dall'app (NON ripetuto qui).
 *
 * Protezione: JWT + RolesGuard, accessibile a SUPER_ADMIN e ADMIN.
 * Lo scoping tenant fine (ADMIN solo sul proprio tenant) e' applicato nel
 * service a partire da `req.user`.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { UserAdminService } from '../../application/admin/user-admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class UserAdminController {
  private readonly logger = new Logger(UserAdminController.name);

  constructor(private readonly userAdminService: UserAdminService) {}

  /**
   * GET /api/v1/admin/users
   * Elenca gli utenti. SUPER_ADMIN puo' filtrare per ?tenantId=...
   * (o vedere tutti). ADMIN vede solo il proprio tenant.
   */
  @Get()
  async list(
    @CurrentUser() currentUser: CurrentUserPayload,
    @Query('tenantId') tenantId?: string,
  ) {
    const users = await this.userAdminService.listUsers(currentUser, tenantId);
    return users.map((u) => this.toResponse(u));
  }

  /**
   * POST /api/v1/admin/users
   * Crea un nuovo utente (Keycloak + DB locale).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() currentUser: CurrentUserPayload,
    @Body() dto: CreateUserDto,
  ) {
    this.logger.log(
      `Creazione utente ${dto.fiscalCode} da parte di ${currentUser.id}`,
    );
    const user = await this.userAdminService.createUser(currentUser, dto);
    return this.toResponse(user);
  }

  /**
   * PATCH /api/v1/admin/users/:id/role
   * Aggiorna il ruolo applicativo.
   */
  @Patch(':id/role')
  async updateRole(
    @CurrentUser() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const user = await this.userAdminService.updateRole(
      currentUser,
      id,
      dto.role as UserRole,
    );
    return this.toResponse(user);
  }

  /**
   * PATCH /api/v1/admin/users/:id/status
   * Abilita/disabilita l'utente.
   */
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() currentUser: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    const user = await this.userAdminService.setEnabled(
      currentUser,
      id,
      dto.enabled,
    );
    return this.toResponse(user);
  }

  /**
   * Proiezione di risposta: espone solo i campi sicuri/utili al client.
   */
  private toResponse(user: {
    id: string;
    tenantId: string;
    keycloakId: string;
    fiscalCode: string;
    firstName: string;
    lastName: string;
    email: string;
    role: UserRole;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      tenantId: user.tenantId,
      keycloakId: user.keycloakId,
      fiscalCode: user.fiscalCode,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
