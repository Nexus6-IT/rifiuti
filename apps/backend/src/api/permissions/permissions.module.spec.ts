import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { PermissionsModule } from './permissions.module'
import { PermissionGuard } from '../guards/permission.guard'
import { PermissionController } from './permission.controller'
import { RoleController } from './role.controller'
import { UserRoleController } from './user-role.controller'
import { AuditController } from './audit.controller'
import { ConsultantController } from './consultant.controller'
import { TemporaryPermissionController } from './temporary-permission.controller'
import { GetUserPermissionsQueryHandler } from '../../application/queries/handlers/get-user-permissions.handler'
import { GetAuditTrailQueryHandler } from '../../application/queries/handlers/get-audit-trail.handler'
import { ReconstructHistoricalPermissionsQueryHandler } from '../../application/queries/handlers/reconstruct-historical-permissions.handler'
import { GetConsultantTenantsQueryHandler } from '../../application/queries/handlers/get-consultant-tenants.handler'
import { GetAggregatedDashboardHandler } from '../../application/queries/handlers/get-aggregated-dashboard.handler'
import { AssignRoleCommandHandler } from '../../application/commands/handlers/assign-role.handler'
import { RevokeRoleCommandHandler } from '../../application/commands/handlers/revoke-role.handler'
import { CreateCustomRoleCommandHandler } from '../../application/commands/handlers/create-custom-role.handler'
import { UpdateCustomRoleCommandHandler } from '../../application/commands/handlers/update-custom-role.handler'
import { DeleteCustomRoleCommandHandler } from '../../application/commands/handlers/delete-custom-role.handler'
import { SwitchTenantContextCommandHandler } from '../../application/commands/handlers/switch-tenant-context.handler'
import { RequestTemporaryPermissionCommandHandler } from '../../application/commands/handlers/request-temporary-permission.handler'
import { ApproveTemporaryPermissionCommandHandler } from '../../application/commands/handlers/approve-temporary-permission.handler'
import { RejectTemporaryPermissionCommandHandler } from '../../application/commands/handlers/reject-temporary-permission.handler'
import { RevokeTemporaryPermissionCommandHandler } from '../../application/commands/handlers/revoke-temporary-permission.handler'

/**
 * DI smoke test per PermissionsModule.
 *
 * `.compile()` risolve l'intero grafo di dipendenze (provider, controller,
 * token DI stringa, coda BullMQ) SENZA invocare i lifecycle hooks
 * (`onModuleInit`), quindi non apre connessioni reali a Redis/Postgres.
 * Scopo: intercettare errori di wiring DI a "tempo di compilazione modulo"
 * senza richiedere infrastruttura. Metodo usato per la diagnosi P4
 * (2026-07-25): un `Test.createTestingModule(...).compile()` senza mai
 * chiamare `.init()` non innesca `onModuleInit` (dove RedisPubSubService apre
 * le connessioni reali), quindi non si blocca.
 */
describe('PermissionsModule (DI wiring)', () => {
  it('resolves the PermissionGuard, tutti e sei i controller e i relativi handler CQRS', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        // In produzione EventEmitterModule.forRoot({ global: true }) è
        // registrato una sola volta in AppModule. Questo test isola
        // PermissionsModule senza passare da AppModule (per non trascinarsi
        // dietro Redis/Postgres reali), quindi deve fornire l'equivalente
        // qui: SwitchTenantContextCommandHandler dipende da EventEmitter2.
        EventEmitterModule.forRoot(),
        PermissionsModule,
      ],
    }).compile()

    const guard = moduleRef.get(PermissionGuard)
    expect(guard).toBeDefined()

    // Token stringa richiesti dal guard e dai controller/handler
    expect(moduleRef.get('UserRoleRepository')).toBeDefined()
    expect(moduleRef.get('PermissionRepository')).toBeDefined()
    expect(moduleRef.get('AbacPolicyRepository')).toBeDefined()
    expect(moduleRef.get('PermissionAuditLogRepository')).toBeDefined()
    expect(moduleRef.get('RoleRepository')).toBeDefined()
    expect(moduleRef.get('TemporaryPermissionGrantRepository')).toBeDefined()
    expect(moduleRef.get('RoleChangeHistoryRepository')).toBeDefined()
    expect(moduleRef.get('ConsultantTenantAssociationRepository')).toBeDefined()

    // I sei controller REST del sottosistema permessi
    expect(moduleRef.get(PermissionController)).toBeDefined()
    expect(moduleRef.get(RoleController)).toBeDefined()
    expect(moduleRef.get(UserRoleController)).toBeDefined()
    expect(moduleRef.get(AuditController)).toBeDefined()
    expect(moduleRef.get(ConsultantController)).toBeDefined()
    expect(moduleRef.get(TemporaryPermissionController)).toBeDefined()

    // Query handler
    expect(moduleRef.get(GetUserPermissionsQueryHandler)).toBeDefined()
    expect(moduleRef.get(GetAuditTrailQueryHandler)).toBeDefined()
    expect(moduleRef.get(ReconstructHistoricalPermissionsQueryHandler)).toBeDefined()
    expect(moduleRef.get(GetConsultantTenantsQueryHandler)).toBeDefined()
    expect(moduleRef.get(GetAggregatedDashboardHandler)).toBeDefined()

    // Command handler
    expect(moduleRef.get(AssignRoleCommandHandler)).toBeDefined()
    expect(moduleRef.get(RevokeRoleCommandHandler)).toBeDefined()
    expect(moduleRef.get(CreateCustomRoleCommandHandler)).toBeDefined()
    expect(moduleRef.get(UpdateCustomRoleCommandHandler)).toBeDefined()
    expect(moduleRef.get(DeleteCustomRoleCommandHandler)).toBeDefined()
    expect(moduleRef.get(SwitchTenantContextCommandHandler)).toBeDefined()
    expect(moduleRef.get(RequestTemporaryPermissionCommandHandler)).toBeDefined()
    expect(moduleRef.get(ApproveTemporaryPermissionCommandHandler)).toBeDefined()
    expect(moduleRef.get(RejectTemporaryPermissionCommandHandler)).toBeDefined()
    expect(moduleRef.get(RevokeTemporaryPermissionCommandHandler)).toBeDefined()

    // NB: non chiamiamo moduleRef.close(). `.compile()` non invoca mai
    // onModuleInit (per questo il test non apre connessioni Redis reali), ma
    // .close() invoca comunque onModuleDestroy: RedisPubSubService vi
    // referenzia this.subscriber/this.publisher, mai inizializzati, causando
    // un TypeError sulla pulizia — rumore di test, non un problema applicativo
    // (in produzione onModuleInit gira sempre prima di onModuleDestroy).
  })
})
