/**
 * PermissionsModule (IAM / RBAC + ABAC wiring)
 *
 * Registra il sottosistema permessi finora implementato ma NON integrato:
 * - PermissionGuard (opt-in via @RequirePermission, NON applicato come APP_GUARD globale)
 * - tutti i token DI stringa richiesti dal guard, mappati alle implementazioni
 *   Prisma concrete in src/infrastructure/persistence/*
 * - i servizi di supporto (cache permessi, valutatore ABAC, Redis)
 * - la coda BullMQ "audit-logging" usata dal guard per il logging asincrono
 * - il PermissionController (lookup permessi utente), le cui dipendenze sono
 *   interamente soddisfacibili tramite useFactory con implementazioni concrete.
 *
 * NOTA DI SCOPE (vincolo conservativo):
 * I controller RoleController / UserRoleController / AuditController /
 * ConsultantController / TemporaryPermissionController NON sono registrati qui
 * perché i loro handler CQRS (assign-role, revoke-role, create/update/delete
 * custom role, ecc.) iniettano le repository di dominio *per interfaccia*
 * (es. `private readonly roleRepository: RoleRepository`) SENZA `@Inject('...')`.
 * Essendo `RoleRepository`/`UserRoleRepository`/... semplici interfacce
 * TypeScript (cancellate a runtime), Nest non può risolverle e il bootstrap
 * fallirebbe. Registrarli richiederebbe prima di rifattorizzare quegli handler
 * per usare token DI espliciti — fuori dallo scope di questo intervento, che
 * deve solo abilitare il guard senza rompere il bootstrap esistente.
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from '../../infrastructure/persistence/prisma.module';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

// Repository implementations (Prisma)
import { PrismaUserRoleRepository } from '../../infrastructure/persistence/user-role.repository';
import { PrismaRoleRepository } from '../../infrastructure/persistence/role.repository';
import { PrismaPermissionRepository } from '../../infrastructure/persistence/permission.repository';
import { PrismaAbacPolicyRepository } from '../../infrastructure/persistence/abac-policy.repository';
import { PrismaPermissionAuditLogRepository } from '../../infrastructure/persistence/permission-audit-log.repository';

// Cache + Redis
import { RedisConfig } from '../../infrastructure/cache/redis.config';
import { RoleCacheService } from '../../infrastructure/cache/role-cache.service';
import { PermissionCacheService } from '../../infrastructure/cache/permission-cache.service';

// ABAC
import { AbacPolicyEvaluator } from '../../domain/identity-access/abac/abac-policy-evaluator.service';

// Guard
import { PermissionGuard } from '../guards/permission.guard';

// Controllers (solo quelli con dipendenze interamente risolvibili)
import { PermissionController } from './permission.controller';
import { GetUserPermissionsQueryHandler } from '../../application/queries/handlers/get-user-permissions.handler';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    // Connessione root BullMQ (nessun BullModule.forRoot esisteva nel progetto).
    // Necessaria affinché @InjectQueue('audit-logging') nel PermissionGuard
    // possa essere risolto. Connessione Redis configurabile via env.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // REDIS_CLUSTER_NODES = "host:port,..." — usiamo il primo nodo per la
        // connessione BullMQ (BullMQ non supporta cluster nativamente qui).
        const nodes = configService.get<string>(
          'REDIS_CLUSTER_NODES',
          'localhost:6379',
        );
        const [host, portStr] = nodes.split(',')[0].split(':');
        return {
          connection: {
            host: host || 'localhost',
            port: parseInt(portStr, 10) || 6379,
            password: configService.get<string>('REDIS_PASSWORD') || undefined,
            db: configService.get<number>('REDIS_DB', 0),
          },
        };
      },
    }),
    // Registra la coda usata dal guard per il logging audit asincrono.
    BullModule.registerQueue({ name: 'audit-logging' }),
  ],
  controllers: [
    // PermissionController: NON usa @RequirePermission (nessuna dipendenza dal
    // PermissionGuard), dipende solo da GetUserPermissionsQueryHandler che
    // wiriamo qui via useFactory con implementazioni concrete.
    PermissionController,
  ],
  providers: [
    // --- Infrastruttura Redis / cache ---
    RedisConfig,
    RoleCacheService,
    PermissionCacheService,

    // --- ABAC ---
    AbacPolicyEvaluator,

    // --- Implementazioni concrete repository (anche come classe, per le
    //     factory che ne hanno bisogno) ---
    PrismaUserRoleRepository,
    PrismaRoleRepository,
    PrismaPermissionRepository,
    PrismaAbacPolicyRepository,
    PrismaPermissionAuditLogRepository,

    // --- Token DI stringa richiesti dal PermissionGuard ---
    { provide: 'UserRoleRepository', useExisting: PrismaUserRoleRepository },
    { provide: 'PermissionRepository', useExisting: PrismaPermissionRepository },
    { provide: 'AbacPolicyRepository', useExisting: PrismaAbacPolicyRepository },
    {
      provide: 'PermissionAuditLogRepository',
      useExisting: PrismaPermissionAuditLogRepository,
    },
    // Alias utili anche per RoleRepository (non richiesto dal guard ma coerente)
    { provide: 'RoleRepository', useExisting: PrismaRoleRepository },

    // --- Guard ---
    PermissionGuard,

    // --- Query handler per PermissionController ---
    // Le repository sono iniettate per interfaccia nel costruttore
    // dell'handler: usiamo useFactory per passare le implementazioni concrete.
    {
      provide: GetUserPermissionsQueryHandler,
      useFactory: (
        userRoleRepo: PrismaUserRoleRepository,
        roleRepo: PrismaRoleRepository,
        permissionRepo: PrismaPermissionRepository,
        permissionCache: PermissionCacheService,
      ) =>
        new GetUserPermissionsQueryHandler(
          userRoleRepo,
          roleRepo,
          permissionRepo,
          permissionCache,
        ),
      inject: [
        PrismaUserRoleRepository,
        PrismaRoleRepository,
        PrismaPermissionRepository,
        PermissionCacheService,
      ],
    },
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
    PermissionCacheService,
    AbacPolicyEvaluator,
  ],
})
export class PermissionsModule {}
