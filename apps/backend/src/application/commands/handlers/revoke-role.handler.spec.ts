import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { RevokeRoleCommandHandler } from './revoke-role.handler';
import { RevokeRoleCommand } from '../revoke-role.command';

/**
 * RevokeRoleCommandHandler — persistenza audit della revoca.
 *
 * Verifica che una revoca andata a buon fine venga accodata come evento
 * 'role-change' (oldRoleId = ruolo revocato, newRoleId = null) sulla coda
 * 'audit-logging', così da essere persistita in RoleChangeHistory dal
 * processor. Chiude il blocker #15 (revoche non tracciate).
 */
describe('RevokeRoleCommandHandler', () => {
  let handler: RevokeRoleCommandHandler;
  let roleRepository: any;
  let userRoleRepository: any;
  let permissionCache: any;
  let redisPubSub: any;
  let auditQueue: any;

  const TENANT = 'tenant-1';
  const USER_ROLE_ID = 'ur-1';
  const ROLE_ID = 'role-1';
  const USER_ID = 'user-1';

  function makeCommand(reason?: string) {
    return new RevokeRoleCommand(USER_ROLE_ID, TENANT, 'admin-1', reason);
  }

  beforeEach(() => {
    roleRepository = {
      findById: jest.fn().mockResolvedValue({ id: ROLE_ID, tenantId: TENANT, name: 'OPERATOR' }),
    };
    userRoleRepository = {
      findById: jest.fn().mockResolvedValue({
        id: USER_ROLE_ID,
        userId: USER_ID,
        roleId: ROLE_ID,
        tenantId: TENANT,
      }),
      revoke: jest.fn().mockResolvedValue(undefined),
      countActiveAdmins: jest.fn().mockResolvedValue(5),
    };
    permissionCache = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    redisPubSub = { publishUserInvalidation: jest.fn().mockResolvedValue(undefined) };
    auditQueue = { add: jest.fn().mockResolvedValue(undefined) };

    handler = new RevokeRoleCommandHandler(
      roleRepository,
      userRoleRepository,
      permissionCache,
      redisPubSub,
      auditQueue,
    );
  });

  it('accoda un evento role-change (revoca) in audit dopo una revoca riuscita', async () => {
    await handler.execute(makeCommand('Offboarding'));

    expect(userRoleRepository.revoke).toHaveBeenCalledWith(USER_ROLE_ID, TENANT);
    expect(auditQueue.add).toHaveBeenCalledTimes(1);
    const [eventName, payload] = auditQueue.add.mock.calls[0];
    expect(eventName).toBe('role-change');
    expect(payload.data).toMatchObject({
      userId: USER_ID,
      tenantId: TENANT,
      oldRoleId: ROLE_ID,
      newRoleId: null,
      changedBy: 'admin-1',
      reason: 'Offboarding',
    });
  });

  it('usa una reason di default quando non fornita', async () => {
    await handler.execute(makeCommand());

    const [, payload] = auditQueue.add.mock.calls[0];
    expect(payload.data.reason).toBe('Role revocation');
  });

  it('non accoda audit se la revoca fallisce (assegnazione inesistente)', async () => {
    userRoleRepository.findById.mockResolvedValue(null);

    await expect(handler.execute(makeCommand())).rejects.toBeInstanceOf(NotFoundException);
    expect(auditQueue.add).not.toHaveBeenCalled();
  });

  it('blocca la revoca dell\'ultimo admin e non accoda audit', async () => {
    roleRepository.findById.mockResolvedValue({ id: ROLE_ID, tenantId: TENANT, name: 'ADMIN' });
    userRoleRepository.countActiveAdmins.mockResolvedValue(1);

    await expect(handler.execute(makeCommand())).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRoleRepository.revoke).not.toHaveBeenCalled();
    expect(auditQueue.add).not.toHaveBeenCalled();
  });
});
