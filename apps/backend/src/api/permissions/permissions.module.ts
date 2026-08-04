/**
 * PermissionsModule (IAM / RBAC + ABAC wiring)
 *
 * Registra l'intero sottosistema permessi granulari:
 * - PermissionGuard (opt-in via @RequirePermission, NON applicato come APP_GUARD globale)
 * - tutti i token DI stringa richiesti dal guard e dagli handler CQRS, mappati alle
 *   implementazioni Prisma concrete in src/infrastructure/persistence/*
 * - i servizi di supporto (cache permessi, pub/sub Redis, valutatore ABAC)
 * - la coda BullMQ "audit-logging" usata dal guard per il logging asincrono
 * - i sei controller REST (permessi, ruoli, assegnazioni ruolo-utente, audit,
 *   consulenti multi-tenant, permessi temporanei) e i relativi handler CQRS
 *
 * STORIA (2026-07-25, pipeline P4):
 * Fino a questo commit erano registrati SOLO PermissionController e il suo query
 * handler. Gli altri cinque controller erano esclusi con un commento che
 * attribuiva l'esclusione a un "bug di injection CQRS" nei loro handler. La
 * diagnosi (vedi docs/adr/2026-07-25-rbac-granulare-riparare-o-rimuovere.md) ha
 * confermato che il problema era reale ma di puro cablaggio, non di sostanza:
 * 1. Diversi handler/controller iniettavano repository *per interfaccia*
 *    (es. `private readonly roleRepository: RoleRepository`) senza `@Inject('...')`
 *    — le interfacce TypeScript sono cancellate a runtime, quindi Nest non poteva
 *    risolvere il token. Corretto aggiungendo `@Inject(...)` in ciascun file.
 * 2. Il modulo non importava mai `CqrsModule`, quindi `CommandBus`/`QueryBus`
 *    (usati da RoleController/AuditController/TemporaryPermissionController) non
 *    erano risolvibili e gli handler `@CommandHandler`/`@QueryHandler` non
 *    venivano mai registrati sui bus.
 * 3. Mancavano provider per RedisPubSubService, per i repository Prisma di
 *    RoleChangeHistory/ConsultantTenantAssociation e per i relativi token
 *    stringa (inclusi 'TemporaryPermissionGrantRepository', già implementato ma
 *    mai esposto come token).
 * 4. JwtService (usato da SwitchTenantContextCommandHandler per rigenerare il
 *    JWT dopo un cambio tenant) proviene da AuthModule, mai importato qui.
 * Nessuna di queste correzioni tocca la logica applicativa: sono aggiunte di
 * provider/import/decoratori di injection.
 */

import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'
import { CqrsModule } from '@nestjs/cqrs'

import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { AuthModule } from '../../auth/auth.module'

// Repository implementations (Prisma)
import { PrismaUserRoleRepository } from '../../infrastructure/persistence/user-role.repository'
import { PrismaRoleRepository } from '../../infrastructure/persistence/role.repository'
import { PrismaPermissionRepository } from '../../infrastructure/persistence/permission.repository'
import { PrismaAbacPolicyRepository } from '../../infrastructure/persistence/abac-policy.repository'
import { PrismaPermissionAuditLogRepository } from '../../infrastructure/persistence/permission-audit-log.repository'
import { PrismaTemporaryPermissionGrantRepository } from '../../infrastructure/persistence/temporary-permission-grant.repository'
import { PrismaRoleChangeHistoryRepository } from '../../infrastructure/persistence/role-change-history.repository'
import { PrismaConsultantTenantAssociationRepository } from '../../infrastructure/persistence/consultant-tenant-association.repository'

// Cache + Redis
import { RedisConfig } from '../../infrastructure/cache/redis.config'
import { RoleCacheService } from '../../infrastructure/cache/role-cache.service'
import { PermissionCacheService } from '../../infrastructure/cache/permission-cache.service'
import { RedisPubSubService } from '../../infrastructure/cache/redis-pub-sub.service'

// ABAC
import { AbacPolicyEvaluator } from '../../domain/identity-access/abac/abac-policy-evaluator.service'

// Guard
import { PermissionGuard } from '../guards/permission.guard'

// Controllers
import { PermissionController } from './permission.controller'
import { RoleController } from './role.controller'
import { UserRoleController } from './user-role.controller'
import { AuditController } from './audit.controller'
import { ConsultantController } from './consultant.controller'
import { TemporaryPermissionController } from './temporary-permission.controller'

// Query handlers
import { GetUserPermissionsQueryHandler } from '../../application/queries/handlers/get-user-permissions.handler'
import { GetAuditTrailQueryHandler } from '../../application/queries/handlers/get-audit-trail.handler'
import { ReconstructHistoricalPermissionsQueryHandler } from '../../application/queries/handlers/reconstruct-historical-permissions.handler'
import { GetConsultantTenantsQueryHandler } from '../../application/queries/handlers/get-consultant-tenants.handler'
import { GetAggregatedDashboardHandler } from '../../application/queries/handlers/get-aggregated-dashboard.handler'

// Command handlers
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

const QUERY_HANDLERS = [
  GetUserPermissionsQueryHandler,
  GetAuditTrailQueryHandler,
  ReconstructHistoricalPermissionsQueryHandler,
  GetConsultantTenantsQueryHandler,
  GetAggregatedDashboardHandler,
]

const COMMAND_HANDLERS = [
  AssignRoleCommandHandler,
  RevokeRoleCommandHandler,
  CreateCustomRoleCommandHandler,
  UpdateCustomRoleCommandHandler,
  DeleteCustomRoleCommandHandler,
  SwitchTenantContextCommandHandler,
  RequestTemporaryPermissionCommandHandler,
  ApproveTemporaryPermissionCommandHandler,
  RejectTemporaryPermissionCommandHandler,
  RevokeTemporaryPermissionCommandHandler,
]

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    // CommandBus/QueryBus: richiesti da RoleController, AuditController e
    // TemporaryPermissionController. Senza questo import gli handler
    // @CommandHandler/@QueryHandler dichiarati sotto NON vengono mai registrati
    // sui bus (bootstrap silenzioso, richieste che restano appese o 500).
    CqrsModule,
    // JwtService: usato da SwitchTenantContextCommandHandler per rigenerare il
    // JWT con il nuovo contesto tenant dopo uno switch consulente.
    AuthModule,
    // Connessione root BullMQ (nessun BullModule.forRoot esisteva nel progetto).
    // Necessaria affinché @InjectQueue('audit-logging') nel PermissionGuard e
    // negli handler assign/revoke-role possa essere risolto. Connessione Redis
    // configurabile via env.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // REDIS_CLUSTER_NODES = "host:port,..." — usiamo il primo nodo per la
        // connessione BullMQ (BullMQ non supporta cluster nativamente qui).
        const nodes = configService.get<string>('REDIS_CLUSTER_NODES', 'localhost:6379')
        const [host, portStr] = nodes.split(',')[0].split(':')
        return {
          connection: {
            host: host || 'localhost',
            port: parseInt(portStr, 10) || 6379,
            password: configService.get<string>('REDIS_PASSWORD') || undefined,
            db: configService.get<number>('REDIS_DB', 0),
          },
        }
      },
    }),
    // Registra la coda usata dal guard per il logging audit asincrono.
    BullModule.registerQueue({ name: 'audit-logging' }),
  ],
  controllers: [
    PermissionController,
    RoleController,
    UserRoleController,
    AuditController,
    ConsultantController,
    TemporaryPermissionController,
  ],
  providers: [
    // --- Infrastruttura Redis / cache ---
    RedisConfig,
    RoleCacheService,
    PermissionCacheService,
    RedisPubSubService,

    // --- ABAC ---
    AbacPolicyEvaluator,

    // --- Implementazioni concrete repository (anche come classe, per le
    //     factory che ne hanno bisogno) ---
    PrismaUserRoleRepository,
    PrismaRoleRepository,
    PrismaPermissionRepository,
    PrismaAbacPolicyRepository,
    PrismaPermissionAuditLogRepository,
    PrismaTemporaryPermissionGrantRepository,
    PrismaRoleChangeHistoryRepository,
    PrismaConsultantTenantAssociationRepository,

    // --- Token DI stringa richiesti dal PermissionGuard e dai controller/handler ---
    { provide: 'UserRoleRepository', useExisting: PrismaUserRoleRepository },
    { provide: 'PermissionRepository', useExisting: PrismaPermissionRepository },
    { provide: 'AbacPolicyRepository', useExisting: PrismaAbacPolicyRepository },
    {
      provide: 'PermissionAuditLogRepository',
      useExisting: PrismaPermissionAuditLogRepository,
    },
    { provide: 'RoleRepository', useExisting: PrismaRoleRepository },
    {
      provide: 'TemporaryPermissionGrantRepository',
      useExisting: PrismaTemporaryPermissionGrantRepository,
    },
    {
      provide: 'RoleChangeHistoryRepository',
      useExisting: PrismaRoleChangeHistoryRepository,
    },
    {
      provide: 'ConsultantTenantAssociationRepository',
      useExisting: PrismaConsultantTenantAssociationRepository,
    },

    // --- Guard ---
    PermissionGuard,

    // --- Handler CQRS (query + command) ---
    ...QUERY_HANDLERS,
    ...COMMAND_HANDLERS,
  ],
  exports: [
    // Esporta il guard e i token così che altri moduli possano applicare
    // @RequirePermission sui propri endpoint riusando questa configurazione.
    PermissionGuard,
    'UserRoleRepository',
    'PermissionRepository',
    'AbacPolicyRepository',
    'PermissionAuditLogRepository',
    'RoleRepository',
    'TemporaryPermissionGrantRepository',
    'RoleChangeHistoryRepository',
    'ConsultantTenantAssociationRepository',
    PermissionCacheService,
    AbacPolicyEvaluator,
  ],
})
export class PermissionsModule {}
