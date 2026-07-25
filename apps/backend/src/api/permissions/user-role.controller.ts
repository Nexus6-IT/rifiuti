import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { TenantIsolationGuard } from '../guards/tenant-isolation.guard'
import { PermissionGuard } from '../guards/permission.guard'
import { RequirePermission } from '../decorators/require-permission.decorator'
import { CurrentTenant } from '../decorators/current-tenant.decorator'
import { CurrentUser } from '../decorators/current-user.decorator'
import { AuditAction } from '../decorators/audit-action.decorator'
import { AssignRoleCommandHandler } from '../../application/commands/handlers/assign-role.handler'
import { RevokeRoleCommandHandler } from '../../application/commands/handlers/revoke-role.handler'
import { AssignRoleCommand } from '../../application/commands/assign-role.command'
import { RevokeRoleCommand } from '../../application/commands/revoke-role.command'
import { UserRoleRepository } from '../../domain/identity-access/user-role.repository.interface'
import { IsUUID, IsOptional, IsISO8601, IsArray, IsBoolean, IsString } from 'class-validator'

/**
 * DTO per l'assegnazione di un ruolo.
 *
 * NOTA (corretto in P4, 2026-07-25): il global `ValidationPipe` in main.ts usa
 * `whitelist: true, forbidNonWhitelisted: true`. Per una classe DTO reale (a
 * differenza dei body tipizzati come oggetto letterale, ignorati dalla
 * validazione perché privi di metadata di classe), class-validator considera
 * "sconosciuta" ogni proprietà priva di un decoratore — e la STRIPPA. Prima di
 * questa correzione `AssignRoleDto` non aveva NESSUN decoratore: ogni body
 * arrivava svuotato di userId/roleId/etc. e la richiesta falliva con 400
 * "property X should not exist" per ogni campo, indipendentemente da chi la
 * chiamasse. Aggiunti i decoratori minimi coerenti con l'uso già fatto nel
 * resto del backend (vedi api/admin/dto/create-user.dto.ts).
 *
 * NOTA sull'ordine: deve restare dichiarata PRIMA di UserRoleController.
 * `emitDecoratorMetadata` genera un riferimento runtime a questa classe per
 * la firma di `assignRole` (`design:paramtypes`), valutato quando i
 * decoratori del metodo vengono applicati — cioè durante l'esecuzione del
 * corpo della classe controller. Se `AssignRoleDto` fosse dichiarata dopo
 * (come lo era in origine), quel riferimento cadrebbe nella temporal dead
 * zone della `class` (hoisted ma non inizializzata) e il modulo lancerebbe
 * `ReferenceError: Cannot access 'AssignRoleDto' before initialization` al
 * bootstrap — impedendo la registrazione dell'intero controller.
 */
export class AssignRoleDto {
  @IsUUID()
  userId: string

  @IsUUID()
  roleId: string

  @IsOptional()
  @IsISO8601()
  expiresAt?: string // ISO 8601 date string

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  facilityIds?: string[]

  @IsOptional()
  @IsBoolean()
  isDelegated?: boolean

  @IsOptional()
  @IsString()
  delegationReason?: string

  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean
}

/**
 * UserRoleController
 * REST API for role assignment operations
 * Per plan.md FR-008: Role assignment with ABAC enforcement
 *
 * All endpoints require:
 * - JWT authentication
 * - Tenant isolation validation
 * - Permission checks
 */
@Controller('user-roles')
@UseGuards(JwtAuthGuard, TenantIsolationGuard, PermissionGuard)
export class UserRoleController {
  private readonly logger = new Logger(UserRoleController.name)

  constructor(
    private readonly assignRoleHandler: AssignRoleCommandHandler,
    private readonly revokeRoleHandler: RevokeRoleCommandHandler,
    @Inject('UserRoleRepository') private readonly userRoleRepository: UserRoleRepository
  ) {}

  /**
   * POST /api/v1/user-roles/assign
   * Assign a role to a user
   * Requires: user:manage-roles:all permission
   *
   * NOTA (corretto in P4, 2026-07-25): il decoratore richiedeva
   * 'user:manage:all', stringa che non esiste nel catalogo permessi seedato
   * (prisma/seeds/permissions.seed.ts definisce 'user:manage-roles:all' —
   * "Assign and revoke user roles" — mai 'user:manage:all'). Nessun ruolo
   * poteva quindi mai soddisfare il controllo: l'endpoint era irraggiungibile
   * per chiunque, ADMIN incluso, indipendentemente dal wiring del modulo.
   */
  @Post('assign')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('user:manage-roles:all')
  @AuditAction('assign_role')
  async assignRole(
    @Body() dto: AssignRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') currentUserId: string
  ) {
    this.logger.log(`Assigning role ${dto.roleId} to user ${dto.userId} in tenant ${tenantId}`)

    const command = new AssignRoleCommand(
      dto.userId,
      dto.roleId,
      tenantId,
      currentUserId,
      dto.expiresAt ? new Date(dto.expiresAt) : null,
      dto.facilityIds || null,
      dto.isDelegated || false,
      dto.delegationReason || null,
      dto.replaceExisting || false
    )

    const userRole = await this.assignRoleHandler.execute(command)

    return {
      id: userRole.id,
      userId: userRole.userId,
      roleId: userRole.roleId,
      tenantId: userRole.tenantId,
      assignedBy: userRole.assignedBy,
      assignedAt: userRole.assignedAt.toISOString(),
      expiresAt: userRole.expiresAt?.toISOString() || null,
      facilityIds: userRole.facilityIds,
      isDelegated: userRole.isDelegated,
      delegationReason: userRole.delegationReason,
    }
  }

  /**
   * DELETE /api/v1/user-roles/:id
   * Revoke a role assignment
   * Requires: user:manage permission
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('user:manage-roles:all')
  @AuditAction('revoke_role')
  async revokeRole(
    @Param('id') userRoleId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') currentUserId: string
  ) {
    this.logger.log(`Revoking user role assignment ${userRoleId} in tenant ${tenantId}`)

    const command = new RevokeRoleCommand(userRoleId, tenantId, currentUserId, 'Revoked via API')

    await this.revokeRoleHandler.execute(command)

    return // 204 No Content
  }

  /**
   * GET /api/v1/user-roles/user/:userId
   * Get all role assignments for a user
   * Requires: user:read permission
   */
  @Get('user/:userId')
  @RequirePermission('user:read:all')
  async getUserRoles(@Param('userId') userId: string, @CurrentTenant() tenantId: string) {
    this.logger.log(`Fetching role assignments for user ${userId}`)

    const userRoles = await this.userRoleRepository.findActiveByUserId(userId, tenantId)

    return {
      userRoles: userRoles.map(ur => ({
        id: ur.id,
        userId: ur.userId,
        roleId: ur.roleId,
        assignedBy: ur.assignedBy,
        assignedAt: ur.assignedAt.toISOString(),
        expiresAt: ur.expiresAt?.toISOString() || null,
        facilityIds: ur.facilityIds,
        isDelegated: ur.isDelegated,
        isActive: ur.isActive(),
      })),
    }
  }
}
