import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { RevokeTemporaryPermissionCommandHandler } from '../../../../src/application/commands/handlers/revoke-temporary-permission.handler'
import { RevokeTemporaryPermissionCommand } from '../../../../src/application/commands/revoke-temporary-permission.command'
import { TemporaryPermissionGrant } from '../../../../src/domain/identity-access/temporary-permission-grant.entity'

/**
 * Unit tests for RevokeTemporaryPermissionCommandHandler
 * T203: Test temporary permission revocation workflow
 *
 * Purpose: Verify revocation logic and state transitions
 *
 * Test coverage:
 * - Approved grant can be revoked
 * - Revoked grant cannot be re-revoked
 * - Pending grant cannot be revoked
 * - Revocation creates audit trail
 */
describe('RevokeTemporaryPermissionCommandHandler', () => {
  let handler: RevokeTemporaryPermissionCommandHandler
  let mockGrantRepository: any

  beforeEach(async () => {
    mockGrantRepository = {
      findById: jest.fn(),
      save: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevokeTemporaryPermissionCommandHandler,
        {
          provide: 'TemporaryPermissionGrantRepository',
          useValue: mockGrantRepository,
        },
      ],
    }).compile()

    handler = module.get<RevokeTemporaryPermissionCommandHandler>(
      RevokeTemporaryPermissionCommandHandler
    )
  })

  describe('execute', () => {
    it('should revoke approved grant successfully', async () => {
      // Arrange
      const approvedGrant = TemporaryPermissionGrant.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime: new Date(Date.now() - 3600000), // 1 hour ago
        endTime: new Date(Date.now() + 3600000), // 1 hour from now
        justification: 'Audit access',
        requestedBy: 'user-123',
      })

      approvedGrant.approve('admin-789', 'Approved for audit')

      const command = new RevokeTemporaryPermissionCommand(
        approvedGrant.id,
        'tenant-456',
        'admin-999',
        'Security concern - revoking early'
      )

      mockGrantRepository.findById.mockResolvedValue(approvedGrant)
      mockGrantRepository.save.mockImplementation(grant => Promise.resolve(grant))

      // Act
      const result = await handler.execute(command)

      // Assert
      expect(result).toBeInstanceOf(TemporaryPermissionGrant)
      expect(result.status).toBe('revoked')
      expect(result.revokedBy).toBe('admin-999')
      expect(result.revocationReason).toBe('Security concern - revoking early')
      expect(result.revokedAt).toBeInstanceOf(Date)
      expect(result.isActive()).toBe(false)

      expect(mockGrantRepository.findById).toHaveBeenCalledWith(approvedGrant.id, 'tenant-456')
      expect(mockGrantRepository.save).toHaveBeenCalled()
    })

    it('should throw NotFoundException if grant does not exist', async () => {
      // Arrange
      const command = new RevokeTemporaryPermissionCommand(
        'non-existent-id',
        'tenant-456',
        'admin-789',
        'Revoke'
      )

      mockGrantRepository.findById.mockResolvedValue(null)

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(NotFoundException)
      expect(mockGrantRepository.save).not.toHaveBeenCalled()
    })

    it('should throw error if grant is not approved', async () => {
      // Arrange
      const pendingGrant = TemporaryPermissionGrant.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime: new Date('2025-11-01T09:00:00Z'),
        endTime: new Date('2025-11-01T17:00:00Z'),
        justification: 'Audit access',
        requestedBy: 'user-123',
      })

      const command = new RevokeTemporaryPermissionCommand(
        pendingGrant.id,
        'tenant-456',
        'admin-789',
        'Revoke pending grant'
      )

      mockGrantRepository.findById.mockResolvedValue(pendingGrant)

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow('Can only revoke approved grants')
      expect(mockGrantRepository.save).not.toHaveBeenCalled()
    })

    it('should throw error if grant is already revoked', async () => {
      // Arrange
      const revokedGrant = TemporaryPermissionGrant.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime: new Date(Date.now() - 7200000),
        endTime: new Date(Date.now() + 3600000),
        justification: 'Audit access',
        requestedBy: 'user-123',
      })

      revokedGrant.approve('admin-789', 'Approved')
      revokedGrant.revoke('admin-789', 'First revocation')

      const command = new RevokeTemporaryPermissionCommand(
        revokedGrant.id,
        'tenant-456',
        'admin-999',
        'Try to revoke again'
      )

      mockGrantRepository.findById.mockResolvedValue(revokedGrant)

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow('Grant is already revoked')
      expect(mockGrantRepository.save).not.toHaveBeenCalled()
    })
  })
})
