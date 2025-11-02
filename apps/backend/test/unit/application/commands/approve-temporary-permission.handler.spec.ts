import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ApproveTemporaryPermissionCommandHandler } from '../../../../src/application/commands/handlers/approve-temporary-permission.handler';
import { ApproveTemporaryPermissionCommand } from '../../../../src/application/commands/approve-temporary-permission.command';
import { TemporaryPermissionGrant } from '../../../../src/domain/identity-access/temporary-permission-grant.entity';

/**
 * Unit tests for ApproveTemporaryPermissionCommandHandler
 * T203: Test temporary permission approval workflow
 *
 * Purpose: Verify approval logic and state transitions
 *
 * Test coverage:
 * - Pending grant can be approved
 * - Already approved grant cannot be re-approved
 * - Approval creates audit trail
 * - Invalid grant ID throws NotFoundException
 */
describe('ApproveTemporaryPermissionCommandHandler', () => {
  let handler: ApproveTemporaryPermissionCommandHandler;
  let mockGrantRepository: any;

  beforeEach(async () => {
    mockGrantRepository = {
      findById: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApproveTemporaryPermissionCommandHandler,
        {
          provide: 'TemporaryPermissionGrantRepository',
          useValue: mockGrantRepository,
        },
      ],
    }).compile();

    handler = module.get<ApproveTemporaryPermissionCommandHandler>(
      ApproveTemporaryPermissionCommandHandler,
    );
  });

  describe('execute', () => {
    it('should approve pending grant successfully', async () => {
      // Arrange
      const pendingGrant = TemporaryPermissionGrant.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime: new Date('2025-11-01T09:00:00Z'),
        endTime: new Date('2025-11-01T17:00:00Z'),
        justification: 'Audit access',
        requestedBy: 'user-123',
      });

      const command = new ApproveTemporaryPermissionCommand(
        pendingGrant.id,
        'tenant-456',
        'admin-789',
        'Approved for quarterly audit',
      );

      mockGrantRepository.findById.mockResolvedValue(pendingGrant);
      mockGrantRepository.save.mockImplementation((grant) => Promise.resolve(grant));

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result).toBeInstanceOf(TemporaryPermissionGrant);
      expect(result.status).toBe('approved');
      expect(result.approvedBy).toBe('admin-789');
      expect(result.approvalReason).toBe('Approved for quarterly audit');
      expect(result.approvedAt).toBeInstanceOf(Date);

      expect(mockGrantRepository.findById).toHaveBeenCalledWith(
        pendingGrant.id,
        'tenant-456',
      );
      expect(mockGrantRepository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if grant does not exist', async () => {
      // Arrange
      const command = new ApproveTemporaryPermissionCommand(
        'non-existent-id',
        'tenant-456',
        'admin-789',
        'Approved',
      );

      mockGrantRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(NotFoundException);
      await expect(handler.execute(command)).rejects.toThrow('Permission grant not found');

      expect(mockGrantRepository.save).not.toHaveBeenCalled();
    });

    it('should throw error if grant is already approved', async () => {
      // Arrange
      const approvedGrant = TemporaryPermissionGrant.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime: new Date('2025-11-01T09:00:00Z'),
        endTime: new Date('2025-11-01T17:00:00Z'),
        justification: 'Audit access',
        requestedBy: 'user-123',
      });

      // Pre-approve the grant
      approvedGrant.approve('admin-999', 'Already approved');

      const command = new ApproveTemporaryPermissionCommand(
        approvedGrant.id,
        'tenant-456',
        'admin-789',
        'Try to approve again',
      );

      mockGrantRepository.findById.mockResolvedValue(approvedGrant);

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        'Grant has already been approved or rejected',
      );

      expect(mockGrantRepository.save).not.toHaveBeenCalled();
    });

    it('should throw error if grant is rejected', async () => {
      // Arrange
      const rejectedGrant = TemporaryPermissionGrant.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        permissions: ['fir:delete:all'],
        startTime: new Date('2025-11-01T09:00:00Z'),
        endTime: new Date('2025-11-01T17:00:00Z'),
        justification: 'Delete access',
        requestedBy: 'user-123',
      });

      // Reject the grant
      rejectedGrant.reject('admin-999', 'Delete not authorized');

      const command = new ApproveTemporaryPermissionCommand(
        rejectedGrant.id,
        'tenant-456',
        'admin-789',
        'Try to approve',
      );

      mockGrantRepository.findById.mockResolvedValue(rejectedGrant);

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        'Grant has already been approved or rejected',
      );
    });
  });
});
