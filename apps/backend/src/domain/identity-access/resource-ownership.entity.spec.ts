import { ResourceOwnership } from '../../../../../apps/backend/src/domain/identity-access/resource-ownership.entity';

/**
 * ResourceOwnership Entity Tests
 * T180: Unit test for ResourceOwnership entity per User Story 6
 *
 * Purpose: Test resource assignment and ownership tracking
 *
 * Requirements from spec.md FR-029-032:
 * - Track which users own/have access to which resources
 * - Support vehicle assignments for drivers
 * - Support facility assignments for operators
 * - Support zone-based routing
 *
 * Requirements from plan.md:
 * - Immutable once created
 * - Support multiple resource types (vehicle, facility, zone)
 * - Track assignment metadata (assigned by, reason, expiration)
 */
describe('ResourceOwnership', () => {
  describe('Creation', () => {
    it('should create resource ownership with required fields', () => {
      // Arrange & Act
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
      });

      // Assert
      expect(ownership.id).toBeDefined();
      expect(ownership.userId).toBe('user-123');
      expect(ownership.tenantId).toBe('tenant-456');
      expect(ownership.resourceType).toBe('vehicle');
      expect(ownership.resourceId).toBe('vehicle-789');
      expect(ownership.assignedBy).toBe('admin-001');
      expect(ownership.assignedAt).toBeInstanceOf(Date);
      expect(ownership.isActive).toBe(true);
    });

    it('should create ownership with optional fields', () => {
      // Arrange
      const expiresAt = new Date('2025-12-31');
      const metadata = { certifications: ['ADR', 'Hazmat'], zone: 'North' };

      // Act
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
        expiresAt,
        metadata,
        reason: 'Driver assignment for Route 5',
      });

      // Assert
      expect(ownership.expiresAt).toBe(expiresAt);
      expect(ownership.metadata).toEqual(metadata);
      expect(ownership.reason).toBe('Driver assignment for Route 5');
    });

    it('should throw error if userId is missing', () => {
      // Arrange & Act & Assert
      expect(() =>
        ResourceOwnership.create({
          userId: '',
          tenantId: 'tenant-456',
          resourceType: 'vehicle',
          resourceId: 'vehicle-789',
          assignedBy: 'admin-001',
        }),
      ).toThrow('userId is required');
    });

    it('should throw error if tenantId is missing', () => {
      // Arrange & Act & Assert
      expect(() =>
        ResourceOwnership.create({
          userId: 'user-123',
          tenantId: '',
          resourceType: 'vehicle',
          resourceId: 'vehicle-789',
          assignedBy: 'admin-001',
        }),
      ).toThrow('tenantId is required');
    });

    it('should throw error if resourceType is missing', () => {
      // Arrange & Act & Assert
      expect(() =>
        ResourceOwnership.create({
          userId: 'user-123',
          tenantId: 'tenant-456',
          resourceType: '',
          resourceId: 'vehicle-789',
          assignedBy: 'admin-001',
        }),
      ).toThrow('resourceType is required');
    });

    it('should throw error if resourceId is missing', () => {
      // Arrange & Act & Assert
      expect(() =>
        ResourceOwnership.create({
          userId: 'user-123',
          tenantId: 'tenant-456',
          resourceType: 'vehicle',
          resourceId: '',
          assignedBy: 'admin-001',
        }),
      ).toThrow('resourceId is required');
    });

    it('should generate unique IDs for different ownerships', () => {
      // Arrange & Act
      const ownership1 = ResourceOwnership.create({
        userId: 'user-1',
        tenantId: 'tenant-1',
        resourceType: 'vehicle',
        resourceId: 'vehicle-1',
        assignedBy: 'admin-1',
      });

      const ownership2 = ResourceOwnership.create({
        userId: 'user-2',
        tenantId: 'tenant-1',
        resourceType: 'vehicle',
        resourceId: 'vehicle-2',
        assignedBy: 'admin-1',
      });

      // Assert
      expect(ownership1.id).not.toBe(ownership2.id);
    });
  });

  describe('Resource Type Validation', () => {
    it('should accept vehicle resource type', () => {
      // Arrange & Act
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
      });

      // Assert
      expect(ownership.resourceType).toBe('vehicle');
    });

    it('should accept facility resource type', () => {
      // Arrange & Act
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'facility',
        resourceId: 'facility-789',
        assignedBy: 'admin-001',
      });

      // Assert
      expect(ownership.resourceType).toBe('facility');
    });

    it('should accept zone resource type', () => {
      // Arrange & Act
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'zone',
        resourceId: 'zone-north',
        assignedBy: 'admin-001',
      });

      // Assert
      expect(ownership.resourceType).toBe('zone');
    });

    it('should accept route resource type', () => {
      // Arrange & Act
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'route',
        resourceId: 'route-5',
        assignedBy: 'admin-001',
      });

      // Assert
      expect(ownership.resourceType).toBe('route');
    });
  });

  describe('Expiration Logic', () => {
    it('should not be expired if no expiration date', () => {
      // Arrange
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
      });

      // Act & Assert
      expect(ownership.isExpired()).toBe(false);
    });

    it('should not be expired if expiration is in the future', () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
        expiresAt: futureDate,
      });

      // Act & Assert
      expect(ownership.isExpired()).toBe(false);
    });

    it('should be expired if expiration is in the past', () => {
      // Arrange
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
        expiresAt: pastDate,
      });

      // Act & Assert
      expect(ownership.isExpired()).toBe(true);
    });

    it('should identify active and not expired ownerships', () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
        expiresAt: futureDate,
      });

      // Act & Assert
      expect(ownership.isActiveAndNotExpired()).toBe(true);
    });

    it('should not be active if expired', () => {
      // Arrange
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
        expiresAt: pastDate,
      });

      // Act & Assert
      expect(ownership.isActiveAndNotExpired()).toBe(false);
    });

    it('should not be active if manually deactivated', () => {
      // Arrange
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
      });

      // Act
      ownership.deactivate('admin-002', 'Reassignment');

      // Assert
      expect(ownership.isActiveAndNotExpired()).toBe(false);
    });
  });

  describe('Deactivation', () => {
    it('should deactivate ownership', () => {
      // Arrange
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
      });

      // Act
      ownership.deactivate('admin-002', 'Driver reassigned');

      // Assert
      expect(ownership.isActive).toBe(false);
      expect(ownership.revokedBy).toBe('admin-002');
      expect(ownership.revocationReason).toBe('Driver reassigned');
      expect(ownership.revokedAt).toBeInstanceOf(Date);
    });

    it('should throw error if deactivating already inactive ownership', () => {
      // Arrange
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
      });

      ownership.deactivate('admin-002', 'First revocation');

      // Act & Assert
      expect(() => ownership.deactivate('admin-003', 'Second revocation')).toThrow(
        'Ownership is already inactive',
      );
    });
  });

  describe('Metadata Management', () => {
    it('should store certifications in metadata', () => {
      // Arrange & Act
      const ownership = ResourceOwnership.create({
        userId: 'driver-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'truck-hazmat-01',
        assignedBy: 'fleet-manager',
        metadata: {
          certifications: ['ADR', 'Hazmat Class 3'],
          zone: 'Industrial Zone',
        },
      });

      // Assert
      expect(ownership.metadata?.certifications).toEqual(['ADR', 'Hazmat Class 3']);
    });

    it('should store zone assignment in metadata', () => {
      // Arrange & Act
      const ownership = ResourceOwnership.create({
        userId: 'driver-123',
        tenantId: 'tenant-456',
        resourceType: 'zone',
        resourceId: 'zone-north',
        assignedBy: 'fleet-manager',
        metadata: {
          zone: 'North',
          capacity: 5,
        },
      });

      // Assert
      expect(ownership.metadata?.zone).toBe('North');
      expect(ownership.metadata?.capacity).toBe(5);
    });

    it('should store custom metadata', () => {
      // Arrange & Act
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
        metadata: {
          customField1: 'value1',
          customField2: 123,
          customField3: true,
        },
      });

      // Assert
      expect(ownership.metadata?.customField1).toBe('value1');
      expect(ownership.metadata?.customField2).toBe(123);
      expect(ownership.metadata?.customField3).toBe(true);
    });
  });

  describe('Immutability', () => {
    it('should be immutable after creation', () => {
      // Arrange
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
      });

      // Act & Assert
      expect(() => {
        (ownership as any).userId = 'different-user';
      }).toThrow();
    });
  });

  describe('Persistence', () => {
    it('should convert to persistence format', () => {
      // Arrange
      const ownership = ResourceOwnership.create({
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
        metadata: { zone: 'North' },
      });

      // Act
      const persisted = ownership.toPersistence();

      // Assert
      expect(persisted).toEqual({
        id: ownership.id,
        userId: 'user-123',
        tenantId: 'tenant-456',
        resourceType: 'vehicle',
        resourceId: 'vehicle-789',
        assignedBy: 'admin-001',
        assignedAt: ownership.assignedAt,
        expiresAt: null,
        isActive: true,
        revokedBy: null,
        revokedAt: null,
        revocationReason: null,
        reason: undefined,
        metadata: { zone: 'North' },
      });
    });

    it('should reconstruct from persistence', () => {
      // Arrange
      const persistedData = {
        id: 'ownership-123',
        userId: 'user-456',
        tenantId: 'tenant-789',
        resourceType: 'vehicle',
        resourceId: 'vehicle-001',
        assignedBy: 'admin-001',
        assignedAt: new Date('2024-01-01'),
        expiresAt: new Date('2024-12-31'),
        isActive: true,
        revokedBy: null,
        revokedAt: null,
        revocationReason: null,
        reason: 'Initial assignment',
        metadata: { zone: 'South' },
      };

      // Act
      const ownership = ResourceOwnership.fromPersistence(persistedData);

      // Assert
      expect(ownership.id).toBe('ownership-123');
      expect(ownership.userId).toBe('user-456');
      expect(ownership.resourceType).toBe('vehicle');
      expect(ownership.metadata?.zone).toBe('South');
    });
  });
});
