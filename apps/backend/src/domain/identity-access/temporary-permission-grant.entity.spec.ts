import { TemporaryPermissionGrant } from './temporary-permission-grant.entity'

/**
 * TemporaryPermissionGrant Entity Tests
 * T195: Unit test for TemporaryPermissionGrant entity per User Story 7
 *
 * Purpose: Test temporary permission elevation for consultants
 *
 * Requirements from spec.md FR-033-036:
 * - Request temporary elevated permissions
 * - Set time bounds (start and end time)
 * - Require justification for audit trail
 * - Support approval/rejection workflow
 * - Auto-expire after end time
 * - Allow manual revocation
 *
 * Requirements from plan.md:
 * - Validate time ranges (endTime > startTime)
 * - Prevent overlapping grants for same user
 * - Track approval/rejection with reason
 * - Immutable once approved
 */
describe('TemporaryPermissionGrant', () => {
  describe('Creation', () => {
    it('should create grant with required fields', () => {
      // Arrange
      const startTime = new Date('2025-11-01T09:00:00Z')
      const endTime = new Date('2025-11-01T17:00:00Z')

      // Act
      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all', 'report:export:all'],
        startTime,
        endTime,
        justification: 'Quarterly audit - need export access for compliance reporting',
        requestedBy: 'consultant-123',
      })

      // Assert
      expect(grant.id).toBeDefined()
      expect(grant.userId).toBe('consultant-123')
      expect(grant.tenantId).toBe('tenant-456')
      expect(grant.permissions).toEqual(['fir:export:all', 'report:export:all'])
      expect(grant.startTime).toBe(startTime)
      expect(grant.endTime).toBe(endTime)
      expect(grant.justification).toBe(
        'Quarterly audit - need export access for compliance reporting'
      )
      expect(grant.status).toBe('pending')
      expect(grant.isApproved()).toBe(false)
    })

    it('should throw error if userId is missing', () => {
      // Arrange & Act & Assert
      expect(() =>
        TemporaryPermissionGrant.create({
          userId: '',
          tenantId: 'tenant-456',
          permissions: ['fir:export:all'],
          startTime: new Date(),
          endTime: new Date(),
          justification: 'Test',
          requestedBy: 'user-123',
        })
      ).toThrow('userId is required')
    })

    it('should throw error if tenantId is missing', () => {
      // Arrange & Act & Assert
      expect(() =>
        TemporaryPermissionGrant.create({
          userId: 'user-123',
          tenantId: '',
          permissions: ['fir:export:all'],
          startTime: new Date(),
          endTime: new Date(),
          justification: 'Test',
          requestedBy: 'user-123',
        })
      ).toThrow('tenantId is required')
    })

    it('should throw error if permissions array is empty', () => {
      // Arrange & Act & Assert
      expect(() =>
        TemporaryPermissionGrant.create({
          userId: 'user-123',
          tenantId: 'tenant-456',
          permissions: [],
          startTime: new Date(),
          endTime: new Date(),
          justification: 'Test',
          requestedBy: 'user-123',
        })
      ).toThrow('At least 1 permission is required')
    })

    it('should throw error if more than 10 permissions', () => {
      // Arrange
      const tooManyPermissions = Array.from({ length: 11 }, (_, i) => `perm:${i}:all`)

      // Act & Assert
      expect(() =>
        TemporaryPermissionGrant.create({
          userId: 'user-123',
          tenantId: 'tenant-456',
          permissions: tooManyPermissions,
          startTime: new Date(),
          endTime: new Date(),
          justification: 'Test',
          requestedBy: 'user-123',
        })
      ).toThrow('Maximum 10 permissions allowed')
    })

    it('should throw error if endTime is before startTime', () => {
      // Arrange
      const startTime = new Date('2025-11-01T17:00:00Z')
      const endTime = new Date('2025-11-01T09:00:00Z') // Earlier

      // Act & Assert
      expect(() =>
        TemporaryPermissionGrant.create({
          userId: 'user-123',
          tenantId: 'tenant-456',
          permissions: ['fir:export:all'],
          startTime,
          endTime,
          justification: 'Test',
          requestedBy: 'user-123',
        })
      ).toThrow('endTime must be after startTime')
    })

    it('should throw error if grant duration exceeds 7 days', () => {
      // Arrange
      const startTime = new Date('2025-11-01T09:00:00Z')
      const endTime = new Date('2025-11-09T09:00:00Z') // 8 days later

      // Act & Assert
      expect(() =>
        TemporaryPermissionGrant.create({
          userId: 'user-123',
          tenantId: 'tenant-456',
          permissions: ['fir:export:all'],
          startTime,
          endTime,
          justification: 'Test',
          requestedBy: 'user-123',
        })
      ).toThrow('Grant duration cannot exceed 7 days')
    })

    it('should throw error if justification is missing', () => {
      // Arrange & Act & Assert
      expect(() =>
        TemporaryPermissionGrant.create({
          userId: 'user-123',
          tenantId: 'tenant-456',
          permissions: ['fir:export:all'],
          startTime: new Date(),
          endTime: new Date(),
          justification: '',
          requestedBy: 'user-123',
        })
      ).toThrow('Justification is required')
    })
  })

  describe('Approval Workflow', () => {
    it('should approve grant', () => {
      // Arrange
      const startTime = new Date('2025-11-01T09:00:00Z')
      const endTime = new Date('2025-11-01T17:00:00Z')

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Audit requirements',
        requestedBy: 'consultant-123',
      })

      // Act
      grant.approve('admin-789', 'Approved for quarterly audit')

      // Assert
      expect(grant.status).toBe('approved')
      expect(grant.isApproved()).toBe(true)
      expect(grant.approvedBy).toBe('admin-789')
      expect(grant.approvalReason).toBe('Approved for quarterly audit')
      expect(grant.approvedAt).toBeInstanceOf(Date)
    })

    it('should reject grant', () => {
      // Arrange
      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:delete:all'],
        startTime: new Date('2025-11-01T09:00:00Z'),
        endTime: new Date('2025-11-01T17:00:00Z'),
        justification: 'Need delete access',
        requestedBy: 'consultant-123',
      })

      // Act
      grant.reject('admin-789', 'Delete permission not authorized for consultants')

      // Assert
      expect(grant.status).toBe('rejected')
      expect(grant.isApproved()).toBe(false)
      expect(grant.approvedBy).toBe('admin-789')
      expect(grant.approvalReason).toBe('Delete permission not authorized for consultants')
      expect(grant.approvedAt).toBeInstanceOf(Date)
    })

    it('should throw error if approving already approved grant', () => {
      // Arrange
      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime: new Date('2025-11-01T09:00:00Z'),
        endTime: new Date('2025-11-01T17:00:00Z'),
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.approve('admin-789', 'Approved')

      // Act & Assert
      expect(() => grant.approve('admin-999', 'Approved again')).toThrow(
        'Grant has already been approved or rejected'
      )
    })

    it('should throw error if rejecting already rejected grant', () => {
      // Arrange
      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime: new Date('2025-11-01T09:00:00Z'),
        endTime: new Date('2025-11-01T17:00:00Z'),
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.reject('admin-789', 'Not authorized')

      // Act & Assert
      expect(() => grant.reject('admin-999', 'Rejected again')).toThrow(
        'Grant has already been approved or rejected'
      )
    })
  })

  describe('Active Status', () => {
    it('should be active if approved and within time bounds', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() - 3600000) // 1 hour ago
      const endTime = new Date(now.getTime() + 3600000) // 1 hour from now

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.approve('admin-789', 'Approved')

      // Act & Assert
      expect(grant.isActive()).toBe(true)
    })

    it('should not be active if not approved', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() - 3600000)
      const endTime = new Date(now.getTime() + 3600000)

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      // Act & Assert
      expect(grant.isActive()).toBe(false)
    })

    it('should not be active if before start time', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() + 3600000) // 1 hour from now
      const endTime = new Date(now.getTime() + 7200000) // 2 hours from now

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.approve('admin-789', 'Approved')

      // Act & Assert
      expect(grant.isActive()).toBe(false)
    })

    it('should not be active if after end time', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() - 7200000) // 2 hours ago
      const endTime = new Date(now.getTime() - 3600000) // 1 hour ago

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.approve('admin-789', 'Approved')

      // Act & Assert
      expect(grant.isActive()).toBe(false)
      expect(grant.isExpired()).toBe(true)
    })

    it('should not be active if revoked', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() - 3600000)
      const endTime = new Date(now.getTime() + 3600000)

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.approve('admin-789', 'Approved')
      grant.revoke('admin-789', 'Security concern')

      // Act & Assert
      expect(grant.isActive()).toBe(false)
    })
  })

  describe('Revocation', () => {
    it('should revoke active grant', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() - 3600000)
      const endTime = new Date(now.getTime() + 3600000)

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.approve('admin-789', 'Approved')

      // Act
      grant.revoke('admin-789', 'Project completed early')

      // Assert
      expect(grant.status).toBe('revoked')
      expect(grant.revokedBy).toBe('admin-789')
      expect(grant.revocationReason).toBe('Project completed early')
      expect(grant.revokedAt).toBeInstanceOf(Date)
      expect(grant.isActive()).toBe(false)
    })

    it('should throw error if revoking non-approved grant', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() + 3600000) // 1 hour from now
      const endTime = new Date(now.getTime() + 7200000) // 2 hours from now

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      // Act & Assert
      expect(() => grant.revoke('admin-789', 'Revoked')).toThrow('Can only revoke approved grants')
    })

    it('should throw error if revoking already revoked grant', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() - 3600000) // 1 hour ago
      const endTime = new Date(now.getTime() + 3600000) // 1 hour from now

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.approve('admin-789', 'Approved')
      grant.revoke('admin-789', 'First revocation')

      // Act & Assert
      expect(() => grant.revoke('admin-999', 'Second revocation')).toThrow(
        'Grant is already revoked'
      )
    })
  })

  describe('Expiration', () => {
    it('should be expired if end time has passed', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() - 7200000)
      const endTime = new Date(now.getTime() - 3600000) // 1 hour ago

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      grant.approve('admin-789', 'Approved')

      // Act & Assert
      expect(grant.isExpired()).toBe(true)
    })

    it('should not be expired if end time is in future', () => {
      // Arrange
      const now = new Date()
      const startTime = new Date(now.getTime() - 3600000)
      const endTime = new Date(now.getTime() + 3600000)

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all'],
        startTime,
        endTime,
        justification: 'Test',
        requestedBy: 'consultant-123',
      })

      // Act & Assert
      expect(grant.isExpired()).toBe(false)
    })
  })

  describe('Persistence', () => {
    it('should convert to persistence format', () => {
      // Arrange
      const startTime = new Date('2025-11-01T09:00:00Z')
      const endTime = new Date('2025-11-01T17:00:00Z')

      const grant = TemporaryPermissionGrant.create({
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all', 'report:export:all'],
        startTime,
        endTime,
        justification: 'Audit',
        requestedBy: 'consultant-123',
      })

      // Act
      const persisted = grant.toPersistence()

      // Assert
      expect(persisted).toEqual({
        id: grant.id,
        userId: 'consultant-123',
        tenantId: 'tenant-456',
        permissions: ['fir:export:all', 'report:export:all'],
        startTime,
        endTime,
        justification: 'Audit',
        requestedBy: 'consultant-123',
        requestedAt: grant.requestedAt,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        approvalReason: null,
        revokedBy: null,
        revokedAt: null,
        revocationReason: null,
      })
    })

    it('should reconstruct from persistence', () => {
      // Arrange
      const persistedData = {
        id: 'grant-123',
        userId: 'consultant-456',
        tenantId: 'tenant-789',
        permissions: ['fir:export:all'],
        startTime: new Date('2025-11-01T09:00:00Z'),
        endTime: new Date('2025-11-01T17:00:00Z'),
        justification: 'Audit',
        requestedBy: 'consultant-456',
        requestedAt: new Date('2025-10-31T08:00:00Z'),
        status: 'approved',
        approvedBy: 'admin-001',
        approvedAt: new Date('2025-10-31T10:00:00Z'),
        approvalReason: 'Approved',
        revokedBy: null,
        revokedAt: null,
        revocationReason: null,
      }

      // Act
      const grant = TemporaryPermissionGrant.fromPersistence(persistedData)

      // Assert
      expect(grant.id).toBe('grant-123')
      expect(grant.userId).toBe('consultant-456')
      expect(grant.status).toBe('approved')
      expect(grant.isApproved()).toBe(true)
      expect(grant.approvedBy).toBe('admin-001')
    })
  })
})
