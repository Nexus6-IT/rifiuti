import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PermissionsModule } from './permissions.module';
import { PermissionGuard } from '../guards/permission.guard';
import { PermissionController } from './permission.controller';
import { GetUserPermissionsQueryHandler } from '../../application/queries/handlers/get-user-permissions.handler';

/**
 * DI smoke test per PermissionsModule.
 *
 * `.compile()` risolve l'intero grafo di dipendenze (provider, controller,
 * token DI stringa, coda BullMQ) SENZA invocare i lifecycle hooks
 * (`onModuleInit`), quindi non apre connessioni reali a Redis/Postgres.
 * Scopo: intercettare errori di wiring DI a "tempo di compilazione modulo"
 * senza richiedere infrastruttura.
 */
describe('PermissionsModule (DI wiring)', () => {
  it('resolves the PermissionGuard and its string-token dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PermissionsModule,
      ],
    }).compile();

    const guard = moduleRef.get(PermissionGuard);
    expect(guard).toBeDefined();

    // Token stringa richiesti dal guard
    expect(moduleRef.get('UserRoleRepository')).toBeDefined();
    expect(moduleRef.get('PermissionRepository')).toBeDefined();
    expect(moduleRef.get('AbacPolicyRepository')).toBeDefined();
    expect(moduleRef.get('PermissionAuditLogRepository')).toBeDefined();

    // Controller + handler
    expect(moduleRef.get(PermissionController)).toBeDefined();
    expect(moduleRef.get(GetUserPermissionsQueryHandler)).toBeDefined();

    await moduleRef.close();
  });
});
