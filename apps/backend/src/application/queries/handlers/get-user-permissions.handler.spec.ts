import { GetUserPermissionsQueryHandler } from './get-user-permissions.handler'
import { GetUserPermissionsQuery } from '../get-user-permissions.query'

/**
 * Verifica l'inclusione dei permessi temporanei attivi (blocker #3) nel calcolo
 * dei permessi effettivi, su cache miss con includeTempPermissions=true.
 */
describe('GetUserPermissionsQueryHandler — permessi temporanei', () => {
  let handler: GetUserPermissionsQueryHandler
  let userRoleRepo: any
  let roleRepo: any
  let permissionRepo: any
  let cache: any
  let tempGrantRepo: any

  beforeEach(() => {
    userRoleRepo = {
      findActiveByUserId: jest.fn().mockResolvedValue([{ roleId: 'role-1', facilityIds: [] }]),
    }
    roleRepo = {}
    permissionRepo = {
      findByRole: jest.fn().mockResolvedValue([{ toString: () => 'fir:read:all' }]),
    }
    cache = {
      getPermissions: jest.fn().mockResolvedValue(null), // cache miss
      setPermissions: jest.fn().mockResolvedValue(undefined),
    }
    tempGrantRepo = { findActiveByUser: jest.fn().mockResolvedValue([]) }

    handler = new GetUserPermissionsQueryHandler(
      userRoleRepo,
      roleRepo,
      permissionRepo,
      cache,
      tempGrantRepo,
    )
  })

  it('include i permessi dei grant temporanei ATTIVI quando richiesto', async () => {
    tempGrantRepo.findActiveByUser.mockResolvedValue([
      { isActive: () => true, permissions: ['fir:export:all'] },
      { isActive: () => false, permissions: ['fir:delete:all'] }, // scaduto/revocato → escluso
    ])

    const result = await handler.execute(
      new GetUserPermissionsQuery('user-1', 'tenant-1', true),
    )

    expect(tempGrantRepo.findActiveByUser).toHaveBeenCalledWith('user-1', 'tenant-1')
    expect(result.permissions).toEqual(expect.arrayContaining(['fir:read:all', 'fir:export:all']))
    expect(result.permissions).not.toContain('fir:delete:all')
  })

  it('non interroga i grant temporanei se includeTempPermissions=false', async () => {
    const result = await handler.execute(
      new GetUserPermissionsQuery('user-1', 'tenant-1', false),
    )

    expect(tempGrantRepo.findActiveByUser).not.toHaveBeenCalled()
    expect(result.permissions).toEqual(['fir:read:all'])
  })
})
