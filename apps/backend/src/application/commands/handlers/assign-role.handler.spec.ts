import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AssignRoleCommandHandler } from './assign-role.handler';
import { AssignRoleCommand } from '../assign-role.command';

/**
 * AssignRoleCommandHandler — validazione tenant dell'utente target.
 *
 * Verifica la barriera anti escalation cross-tenant (blocker #4 TODO_INVENTORY):
 * un ruolo NON può essere assegnato a un utente inesistente né a un utente di
 * un altro tenant.
 */
describe('AssignRoleCommandHandler', () => {
  let handler: AssignRoleCommandHandler;
  let roleRepository: any;
  let userRoleRepository: any;
  let permissionCache: any;
  let redisPubSub: any;
  let prisma: any;
  let auditQueue: any;

  const TENANT = 'tenant-1';
  const ROLE_ID = 'role-1';

  function makeCommand(overrides: Partial<Record<string, any>> = {}) {
    return new AssignRoleCommand(
      overrides.userId ?? 'user-1',
      overrides.roleId ?? ROLE_ID,
      overrides.tenantId ?? TENANT,
      overrides.assignedBy ?? 'admin-1',
    );
  }

  beforeEach(() => {
    roleRepository = {
      findById: jest.fn().mockResolvedValue({ id: ROLE_ID, tenantId: TENANT, name: 'OPERATOR' }),
      findByName: jest.fn().mockResolvedValue(null),
    };
    userRoleRepository = {
      findByUserIdAndRoleId: jest.fn().mockResolvedValue(null),
      findActiveByUserId: jest.fn().mockResolvedValue([]),
      countActiveAdmins: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockImplementation((ur) => Promise.resolve(ur)),
    };
    permissionCache = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    redisPubSub = { publishUserInvalidation: jest.fn().mockResolvedValue(undefined) };
    prisma = { user: { findUnique: jest.fn() } };
    auditQueue = { add: jest.fn().mockResolvedValue(undefined) };

    handler = new AssignRoleCommandHandler(
      roleRepository,
      userRoleRepository,
      permissionCache,
      redisPubSub,
      prisma,
      auditQueue,
    );
  });

  it('rifiuta l\'assegnazione se l\'utente target non esiste', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(handler.execute(makeCommand())).rejects.toBeInstanceOf(NotFoundException);
    expect(userRoleRepository.save).not.toHaveBeenCalled();
  });

  it('rifiuta l\'assegnazione cross-tenant (utente di un altro tenant)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-OTHER' });

    await expect(handler.execute(makeCommand())).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRoleRepository.save).not.toHaveBeenCalled();
  });

  it('procede quando utente esiste ed appartiene al tenant', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', tenantId: TENANT });

    const result = await handler.execute(makeCommand());

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true, tenantId: true },
    });
    expect(userRoleRepository.save).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });
});
