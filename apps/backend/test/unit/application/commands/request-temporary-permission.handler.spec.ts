import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { RequestTemporaryPermissionCommandHandler } from '../../../../src/application/commands/handlers/request-temporary-permission.handler'
import { RequestTemporaryPermissionCommand } from '../../../../src/application/commands/request-temporary-permission.command'
import { TemporaryPermissionGrant } from '../../../../src/domain/identity-access/temporary-permission-grant.entity'

/**
 * Unit tests for RequestTemporaryPermissionCommandHandler
 * T203: Test temporary permission request workflow
 *
 * Purpose: Verify request validation and grant creation
 *
 * Test coverage:
 * - Valid permission request creates pending grant
 * - Duplicate/overlapping requests are rejected
 * - Invalid time ranges are rejected
 * - Max permission limit is enforced
 */
describe('RequestTemporaryPermissionCommandHandler', () => {
  let handler: RequestTemporaryPermissionCommandHandler
  let mockGrantRepository: any

  beforeEach(async () => {
    mockGrantRepository = {
      hasOverlappingGrant: jest.fn(),
      save: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestTemporaryPermissionCommandHandler,
        {
          provide: 'TemporaryPermissionGrantRepository',
          useValue: mockGrantRepository,
        },
      ],
    }).compile()

    handler = module.get<RequestTemporaryPermissionCommandHandler>(
      RequestTemporaryPermissionCommandHandler
    )
  })

  describe('execute', () => {
    it('should create permission request successfully', async () => {
      // Arrange
      const command = new RequestTemporaryPermissionCommand(
        'user-123',
        'tenant-456',
        ['fir:export:all', 'report:read:all'],
        new Date('2025-11-01T09:00:00Z'),
        new Date('2025-11-01T17:00:00Z'),
        'Need export access for quarterly audit'
      )

      mockGrantRepository.hasOverlappingGrant.mockResolvedValue(false)
      mockGrantRepository.save.mockImplementation(grant => Promise.resolve(grant))

      // Act
      const result = await handler.execute(command)

      // Assert
      expect(result).toBeInstanceOf(TemporaryPermissionGrant)
      expect(result.userId).toBe('user-123')
      expect(result.tenantId).toBe('tenant-456')
      expect(result.permissions).toEqual(['fir:export:all', 'report:read:all'])
      expect(result.status).toBe('pending')
      expect(result.justification).toBe('Need export access for quarterly audit')

      expect(mockGrantRepository.hasOverlappingGrant).toHaveBeenCalledWith(
        'user-123',
        'tenant-456',
        ['fir:export:all', 'report:read:all'],
        expect.any(Date),
        expect.any(Date)
      )
      expect(mockGrantRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          tenantId: 'tenant-456',
        })
      )
    })

    it('should reject request if overlapping grant exists', async () => {
      // Arrange
      const command = new RequestTemporaryPermissionCommand(
        'user-123',
        'tenant-456',
        ['fir:export:all'],
        new Date('2025-11-01T09:00:00Z'),
        new Date('2025-11-01T17:00:00Z'),
        'Audit access'
      )

      mockGrantRepository.hasOverlappingGrant.mockResolvedValue(true)

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(BadRequestException)
      await expect(handler.execute(command)).rejects.toThrow(
        'You already have an overlapping permission grant for this time period'
      )

      expect(mockGrantRepository.save).not.toHaveBeenCalled()
    })

    it('should reject request with invalid time range', async () => {
      // Arrange - end time before start time
      const command = new RequestTemporaryPermissionCommand(
        'user-123',
        'tenant-456',
        ['fir:export:all'],
        new Date('2025-11-01T17:00:00Z'), // Start
        new Date('2025-11-01T09:00:00Z'), // End (before start)
        'Audit access'
      )

      mockGrantRepository.hasOverlappingGrant.mockResolvedValue(false)

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow()
    })

    it('should reject request exceeding 7 days', async () => {
      // Arrange
      const startTime = new Date('2025-11-01T09:00:00Z')
      const endTime = new Date('2025-11-09T09:00:00Z') // 8 days later

      const command = new RequestTemporaryPermissionCommand(
        'user-123',
        'tenant-456',
        ['fir:export:all'],
        startTime,
        endTime,
        'Audit access'
      )

      mockGrantRepository.hasOverlappingGrant.mockResolvedValue(false)

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow('Grant duration cannot exceed 7 days')
    })

    it('should reject request with more than 10 permissions', async () => {
      // Arrange
      const tooManyPermissions = Array.from({ length: 11 }, (_, i) => `perm:${i}:all`)

      const command = new RequestTemporaryPermissionCommand(
        'user-123',
        'tenant-456',
        tooManyPermissions,
        new Date('2025-11-01T09:00:00Z'),
        new Date('2025-11-01T17:00:00Z'),
        'Audit access'
      )

      mockGrantRepository.hasOverlappingGrant.mockResolvedValue(false)

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow('Maximum 10 permissions allowed')
    })

    it('should reject request with empty justification', async () => {
      // Arrange
      const command = new RequestTemporaryPermissionCommand(
        'user-123',
        'tenant-456',
        ['fir:export:all'],
        new Date('2025-11-01T09:00:00Z'),
        new Date('2025-11-01T17:00:00Z'),
        '' // Empty justification
      )

      mockGrantRepository.hasOverlappingGrant.mockResolvedValue(false)

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow('Justification is required')
    })
  })
})
