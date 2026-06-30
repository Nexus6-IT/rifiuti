import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { TaskAssignmentService } from './task-assignment.service'
import { ResourceOwnershipRepository } from '../../domain/identity-access/resource-ownership.repository.interface'
import { FIRRepository } from '../../domain/fir/fir.repository'

/**
 * TaskAssignmentService Tests
 * T181: Unit test for task assignment routing logic per User Story 6
 *
 * Purpose: Test automated routing of FIR pickup requests to qualified drivers
 *
 * Requirements from spec.md FR-029-032:
 * - Assign tasks based on certifications (e.g., ADR for hazardous waste)
 * - Respect zone assignments (driver must be assigned to pickup zone)
 * - Consider vehicle capacity
 * - Balance workload across available drivers
 * - Handle priority/urgent assignments
 *
 * Requirements from plan.md:
 * - Rule-based assignment engine
 * - Fallback to manual assignment if no qualified driver
 * - Audit trail for all assignments
 * - Real-time availability checking
 */
describe('TaskAssignmentService', () => {
  let service: TaskAssignmentService
  let resourceOwnershipRepository: jest.Mocked<ResourceOwnershipRepository>
  let firRepository: jest.Mocked<FIRRepository>

  const mockTenantId = 'tenant-123'
  const mockFleetManagerId = 'fleet-manager-456'

  beforeEach(async () => {
    // Mock repositories
    const mockResourceOwnershipRepo = {
      findActiveByTenant: jest.fn(),
      findByUserId: jest.fn(),
      findByResourceId: jest.fn(),
      save: jest.fn(),
    }

    const mockFirRepo = {
      findById: jest.fn(),
      save: jest.fn(),
      getCurrentWorkloadByDriver: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskAssignmentService,
        {
          provide: 'ResourceOwnershipRepository',
          useValue: mockResourceOwnershipRepo,
        },
        {
          provide: 'FIRRepository',
          useValue: mockFirRepo,
        },
      ],
    }).compile()

    service = module.get<TaskAssignmentService>(TaskAssignmentService)
    resourceOwnershipRepository = module.get('ResourceOwnershipRepository')
    firRepository = module.get('FIRRepository')
  })

  describe('findQualifiedDrivers', () => {
    it('should find drivers with matching certifications', async () => {
      // Arrange: FIR requires ADR certification
      const firId = 'fir-hazmat-001'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: ['ADR', 'Hazmat'],
        pickupZone: 'Zone-North',
        estimatedWeight: 500, // kg
      }

      const mockDriverOwnerships = [
        {
          userId: 'driver-1',
          resourceType: 'vehicle',
          resourceId: 'truck-1',
          metadata: {
            certifications: ['ADR', 'Hazmat', 'Class-3'],
            zone: 'Zone-North',
            capacity: 1000,
          },
          isActiveAndNotExpired: () => true,
        },
        {
          userId: 'driver-2',
          resourceType: 'vehicle',
          resourceId: 'truck-2',
          metadata: {
            certifications: ['Basic'],
            zone: 'Zone-North',
            capacity: 800,
          },
          isActiveAndNotExpired: () => true,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findActiveByTenant.mockResolvedValue(mockDriverOwnerships as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(200)

      // Act
      const qualifiedDrivers = await service.findQualifiedDrivers(firId, mockTenantId)

      // Assert
      expect(qualifiedDrivers).toHaveLength(1)
      expect(qualifiedDrivers[0].userId).toBe('driver-1')
      expect(qualifiedDrivers[0].certifications).toContain('ADR')
    })

    it('should filter by zone assignment', async () => {
      // Arrange: FIR in Zone-South, drivers in different zones
      const firId = 'fir-south-001'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: [],
        pickupZone: 'Zone-South',
        estimatedWeight: 300,
      }

      const mockDriverOwnerships = [
        {
          userId: 'driver-1',
          metadata: {
            certifications: [],
            zone: 'Zone-North',
            capacity: 1000,
          },
          isActiveAndNotExpired: () => true,
        },
        {
          userId: 'driver-2',
          metadata: {
            certifications: [],
            zone: 'Zone-South',
            capacity: 800,
          },
          isActiveAndNotExpired: () => true,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findActiveByTenant.mockResolvedValue(mockDriverOwnerships as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(100)

      // Act
      const qualifiedDrivers = await service.findQualifiedDrivers(firId, mockTenantId)

      // Assert
      expect(qualifiedDrivers).toHaveLength(1)
      expect(qualifiedDrivers[0].userId).toBe('driver-2')
      expect(qualifiedDrivers[0].zone).toBe('Zone-South')
    })

    it('should check vehicle capacity', async () => {
      // Arrange: Heavy FIR (900kg), drivers with different capacities
      const firId = 'fir-heavy-001'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: [],
        pickupZone: 'Zone-North',
        estimatedWeight: 900,
      }

      const mockDriverOwnerships = [
        {
          userId: 'driver-small-truck',
          metadata: {
            certifications: [],
            zone: 'Zone-North',
            capacity: 500, // Too small
          },
          isActiveAndNotExpired: () => true,
        },
        {
          userId: 'driver-large-truck',
          metadata: {
            certifications: [],
            zone: 'Zone-North',
            capacity: 1500, // Sufficient
          },
          isActiveAndNotExpired: () => true,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findActiveByTenant.mockResolvedValue(mockDriverOwnerships as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(0)

      // Act
      const qualifiedDrivers = await service.findQualifiedDrivers(firId, mockTenantId)

      // Assert
      expect(qualifiedDrivers).toHaveLength(1)
      expect(qualifiedDrivers[0].userId).toBe('driver-large-truck')
      expect(qualifiedDrivers[0].capacity).toBe(1500)
    })

    it('should consider current workload', async () => {
      // Arrange: Driver already has tasks
      const firId = 'fir-001'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: [],
        pickupZone: 'Zone-North',
        estimatedWeight: 300,
      }

      const mockDriverOwnerships = [
        {
          userId: 'driver-busy',
          resourceId: 'truck-1',
          metadata: {
            certifications: [],
            zone: 'Zone-North',
            capacity: 2000, // Increased to accommodate both workload + FIR
          },
          isActiveAndNotExpired: () => true,
        },
        {
          userId: 'driver-available',
          resourceId: 'truck-2',
          metadata: {
            certifications: [],
            zone: 'Zone-North',
            capacity: 1000,
          },
          isActiveAndNotExpired: () => true,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findActiveByTenant.mockResolvedValue(mockDriverOwnerships as any)

      // Mock workload: driver-busy has 800kg already assigned
      firRepository.getCurrentWorkloadByDriver
        .mockResolvedValueOnce(800) // driver-busy
        .mockResolvedValueOnce(100) // driver-available

      // Act
      const qualifiedDrivers = await service.findQualifiedDrivers(firId, mockTenantId)

      // Assert: Both are technically qualified, but driver-available should rank higher
      expect(qualifiedDrivers).toHaveLength(2)
      expect(qualifiedDrivers[0].userId).toBe('driver-available')
      expect(qualifiedDrivers[0].currentWorkload).toBe(100)
    })

    it('should exclude expired or inactive ownerships', async () => {
      // Arrange
      const firId = 'fir-001'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: [],
        pickupZone: 'Zone-North',
        estimatedWeight: 300,
      }

      const mockDriverOwnerships = [
        {
          userId: 'driver-expired',
          metadata: {
            certifications: [],
            zone: 'Zone-North',
            capacity: 1000,
          },
          isActiveAndNotExpired: () => false, // Expired
        },
        {
          userId: 'driver-active',
          metadata: {
            certifications: [],
            zone: 'Zone-North',
            capacity: 1000,
          },
          isActiveAndNotExpired: () => true,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findActiveByTenant.mockResolvedValue(mockDriverOwnerships as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(0)

      // Act
      const qualifiedDrivers = await service.findQualifiedDrivers(firId, mockTenantId)

      // Assert
      expect(qualifiedDrivers).toHaveLength(1)
      expect(qualifiedDrivers[0].userId).toBe('driver-active')
    })

    it('should return empty array if no qualified drivers', async () => {
      // Arrange: FIR requires ADR, but no drivers have it
      const firId = 'fir-hazmat-002'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: ['ADR'],
        pickupZone: 'Zone-North',
        estimatedWeight: 500,
      }

      const mockDriverOwnerships = [
        {
          userId: 'driver-no-cert',
          metadata: {
            certifications: ['Basic'],
            zone: 'Zone-North',
            capacity: 1000,
          },
          isActiveAndNotExpired: () => true,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findActiveByTenant.mockResolvedValue(mockDriverOwnerships as any)

      // Act
      const qualifiedDrivers = await service.findQualifiedDrivers(firId, mockTenantId)

      // Assert
      expect(qualifiedDrivers).toHaveLength(0)
    })

    it('should throw NotFoundException if FIR does not exist', async () => {
      // Arrange
      const firId = 'nonexistent-fir'

      firRepository.findById.mockResolvedValue(null)

      // Act & Assert
      await expect(service.findQualifiedDrivers(firId, mockTenantId)).rejects.toThrow(
        NotFoundException
      )
      await expect(service.findQualifiedDrivers(firId, mockTenantId)).rejects.toThrow(
        'FIR not found'
      )
    })
  })

  describe('autoAssignTask', () => {
    it('should automatically assign FIR to best qualified driver', async () => {
      // Arrange
      const firId = 'fir-auto-001'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: [],
        pickupZone: 'Zone-North',
        estimatedWeight: 300,
        assignDriver: jest.fn(),
      }

      const mockQualifiedDrivers = [
        {
          userId: 'driver-2',
          currentWorkload: 100, // Less busy - should be first (highest score)
          capacity: 1000,
          zone: 'Zone-North',
          score: 120,
        },
        {
          userId: 'driver-1',
          currentWorkload: 500,
          capacity: 1000,
          zone: 'Zone-North',
          score: 100,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      jest.spyOn(service, 'findQualifiedDrivers').mockResolvedValue(mockQualifiedDrivers as any)
      firRepository.save.mockResolvedValue(mockFir as any)

      // Act
      const assignment = await service.autoAssignTask(firId, mockTenantId, mockFleetManagerId)

      // Assert
      expect(assignment.assignedDriverId).toBe('driver-2') // Less busy driver
      expect(assignment.assignedBy).toBe(mockFleetManagerId)
      expect(assignment.assignmentMethod).toBe('automatic')
      expect(mockFir.assignDriver).toHaveBeenCalledWith('driver-2', mockFleetManagerId)
    })

    it('should throw error if no qualified drivers available', async () => {
      // Arrange
      const firId = 'fir-no-drivers'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: ['ADR'],
        pickupZone: 'Zone-North',
      }

      firRepository.findById.mockResolvedValue(mockFir as any)
      jest.spyOn(service, 'findQualifiedDrivers').mockResolvedValue([])

      // Act & Assert
      await expect(service.autoAssignTask(firId, mockTenantId, mockFleetManagerId)).rejects.toThrow(
        BadRequestException
      )
      await expect(service.autoAssignTask(firId, mockTenantId, mockFleetManagerId)).rejects.toThrow(
        'No qualified drivers available for this task. Please assign manually.'
      )
    })

    it('should prioritize drivers with exact certification match', async () => {
      // Arrange
      const firId = 'fir-specific-cert'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: ['ADR', 'Hazmat-Class-3'],
        pickupZone: 'Zone-North',
        estimatedWeight: 300,
        assignDriver: jest.fn(),
      }

      const mockQualifiedDrivers = [
        {
          userId: 'driver-exact',
          certifications: ['ADR', 'Hazmat-Class-3'], // Exact match - higher score
          currentWorkload: 150,
          capacity: 1000,
          score: 125, // Higher score due to exact match
        },
        {
          userId: 'driver-overqualified',
          certifications: ['ADR', 'Hazmat-Class-3', 'Hazmat-Class-5'],
          currentWorkload: 100,
          capacity: 1000,
          score: 120,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      jest.spyOn(service, 'findQualifiedDrivers').mockResolvedValue(mockQualifiedDrivers as any)
      firRepository.save.mockResolvedValue(mockFir as any)

      // Act
      const assignment = await service.autoAssignTask(firId, mockTenantId, mockFleetManagerId)

      // Assert: Should prefer exact match even if slightly busier
      expect(assignment.assignedDriverId).toBe('driver-exact')
    })

    it('should handle priority/urgent assignments', async () => {
      // Arrange: Urgent FIR should get priority
      const firId = 'fir-urgent'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: [],
        pickupZone: 'Zone-North',
        estimatedWeight: 300,
        priority: 'urgent',
        assignDriver: jest.fn(),
      }

      const mockQualifiedDrivers = [
        {
          userId: 'driver-available',
          currentWorkload: 0,
          capacity: 1000,
        },
      ]

      firRepository.findById.mockResolvedValue(mockFir as any)
      jest.spyOn(service, 'findQualifiedDrivers').mockResolvedValue(mockQualifiedDrivers as any)
      firRepository.save.mockResolvedValue(mockFir as any)

      // Act
      const assignment = await service.autoAssignTask(firId, mockTenantId, mockFleetManagerId)

      // Assert
      expect(assignment.assignedDriverId).toBe('driver-available')
      expect(assignment.priority).toBe('urgent')
    })
  })

  describe('manualAssignTask', () => {
    it('should allow manual assignment to qualified driver', async () => {
      // Arrange
      const firId = 'fir-manual-001'
      const driverId = 'driver-123'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: ['ADR'],
        assignDriver: jest.fn(),
      }

      const mockDriverOwnership = {
        userId: driverId,
        resourceType: 'vehicle',
        metadata: {
          certifications: ['ADR'],
          zone: 'Zone-North',
          capacity: 1000,
        },
        isActiveAndNotExpired: () => true,
      }

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findByUserId.mockResolvedValue([mockDriverOwnership] as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(200)
      firRepository.save.mockResolvedValue(mockFir as any)

      // Act
      const assignment = await service.manualAssignTask(
        firId,
        driverId,
        mockTenantId,
        mockFleetManagerId
      )

      // Assert
      expect(assignment.assignedDriverId).toBe(driverId)
      expect(assignment.assignmentMethod).toBe('manual')
      expect(mockFir.assignDriver).toHaveBeenCalledWith(driverId, mockFleetManagerId)
    })

    it('should warn but allow manual assignment to unqualified driver', async () => {
      // Arrange: Driver lacks required certification
      const firId = 'fir-manual-002'
      const driverId = 'driver-no-cert'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        requiredCertifications: ['ADR'],
        assignDriver: jest.fn(),
      }

      const mockDriverOwnership = {
        userId: driverId,
        resourceType: 'vehicle',
        metadata: {
          certifications: ['Basic'], // Missing ADR
          zone: 'Zone-North',
          capacity: 1000,
        },
        isActiveAndNotExpired: () => true,
      }

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findByUserId.mockResolvedValue([mockDriverOwnership] as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(200)
      firRepository.save.mockResolvedValue(mockFir as any)

      // Act
      const assignment = await service.manualAssignTask(
        firId,
        driverId,
        mockTenantId,
        mockFleetManagerId
      )

      // Assert
      expect(assignment.assignedDriverId).toBe(driverId)
      expect(assignment.warnings).toContain('Driver lacks required certifications: ADR')
      expect(assignment.assignmentMethod).toBe('manual')
    })

    it('should throw error if driver does not exist', async () => {
      // Arrange
      const firId = 'fir-manual-003'
      const driverId = 'nonexistent-driver'

      firRepository.findById.mockResolvedValue({
        id: firId,
        tenantId: mockTenantId,
      } as any)
      resourceOwnershipRepository.findByUserId.mockResolvedValue([])

      // Act & Assert
      await expect(
        service.manualAssignTask(firId, driverId, mockTenantId, mockFleetManagerId)
      ).rejects.toThrow(NotFoundException)
      await expect(
        service.manualAssignTask(firId, driverId, mockTenantId, mockFleetManagerId)
      ).rejects.toThrow('Driver not found or has no active vehicle assignment')
    })

    it('should prevent assignment if driver capacity exceeded', async () => {
      // Arrange: Driver's vehicle at max capacity
      const firId = 'fir-overload'
      const driverId = 'driver-full'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        estimatedWeight: 500,
      }

      const mockDriverOwnership = {
        userId: driverId,
        resourceType: 'vehicle',
        metadata: {
          certifications: [],
          zone: 'Zone-North',
          capacity: 1000,
        },
        isActiveAndNotExpired: () => true,
      }

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findByUserId.mockResolvedValue([mockDriverOwnership] as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(800) // 800 + 500 > 1000

      // Act & Assert
      await expect(
        service.manualAssignTask(firId, driverId, mockTenantId, mockFleetManagerId)
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.manualAssignTask(firId, driverId, mockTenantId, mockFleetManagerId)
      ).rejects.toThrow('Vehicle capacity exceeded')
    })
  })

  describe('reassignTask', () => {
    it('should reassign FIR to different driver', async () => {
      // Arrange
      const firId = 'fir-reassign-001'
      const oldDriverId = 'driver-old'
      const newDriverId = 'driver-new'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        assignedDriverId: oldDriverId,
        assignDriver: jest.fn(),
      }

      const mockNewDriverOwnership = {
        userId: newDriverId,
        resourceType: 'vehicle',
        metadata: {
          certifications: [],
          zone: 'Zone-North',
          capacity: 1000,
        },
        isActiveAndNotExpired: () => true,
      }

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findByUserId.mockResolvedValue([mockNewDriverOwnership] as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(200)
      firRepository.save.mockResolvedValue(mockFir as any)

      // Act
      const reassignment = await service.reassignTask(
        firId,
        newDriverId,
        mockTenantId,
        mockFleetManagerId,
        'Driver unavailable'
      )

      // Assert
      expect(reassignment.assignedDriverId).toBe(newDriverId)
      expect(reassignment.previousDriverId).toBe(oldDriverId)
      expect(reassignment.reason).toBe('Driver unavailable')
      expect(mockFir.assignDriver).toHaveBeenCalledWith(newDriverId, mockFleetManagerId)
    })

    it('should create audit trail for reassignment', async () => {
      // Arrange
      const firId = 'fir-reassign-002'
      const oldDriverId = 'driver-old'
      const newDriverId = 'driver-new'
      const mockFir = {
        id: firId,
        tenantId: mockTenantId,
        assignedDriverId: oldDriverId,
        assignDriver: jest.fn(),
      }

      const mockNewDriverOwnership = {
        userId: newDriverId,
        resourceType: 'vehicle',
        metadata: {
          certifications: [],
          zone: 'Zone-North',
          capacity: 1000,
        },
        isActiveAndNotExpired: () => true,
      }

      firRepository.findById.mockResolvedValue(mockFir as any)
      resourceOwnershipRepository.findByUserId.mockResolvedValue([mockNewDriverOwnership] as any)
      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(100)
      firRepository.save.mockResolvedValue(mockFir as any)

      // Act
      const reassignment = await service.reassignTask(
        firId,
        newDriverId,
        mockTenantId,
        mockFleetManagerId,
        'Emergency reassignment'
      )

      // Assert
      expect(reassignment.auditTrail).toBeDefined()
      expect(reassignment.auditTrail?.action).toBe('reassign')
      expect(reassignment.auditTrail?.performedBy).toBe(mockFleetManagerId)
      expect(reassignment.auditTrail?.reason).toBe('Emergency reassignment')
    })
  })

  describe('getDriverWorkload', () => {
    it('should calculate current driver workload', async () => {
      // Arrange
      const driverId = 'driver-123'
      const currentWorkload = 650 // kg

      firRepository.getCurrentWorkloadByDriver.mockResolvedValue(currentWorkload)

      // Act
      const workload = await service.getDriverWorkload(driverId, mockTenantId)

      // Assert
      expect(workload).toBe(650)
      expect(firRepository.getCurrentWorkloadByDriver).toHaveBeenCalledWith(driverId, mockTenantId)
    })
  })

  describe('getDriverCapacity', () => {
    it('should return driver vehicle capacity', async () => {
      // Arrange
      const driverId = 'driver-123'
      const mockOwnership = {
        userId: driverId,
        resourceType: 'vehicle',
        metadata: {
          capacity: 1500,
        },
        isActiveAndNotExpired: () => true,
      }

      resourceOwnershipRepository.findByUserId.mockResolvedValue([mockOwnership] as any)

      // Act
      const capacity = await service.getDriverCapacity(driverId, mockTenantId)

      // Assert
      expect(capacity).toBe(1500)
    })

    it('should return 0 if driver has no vehicle assignment', async () => {
      // Arrange
      const driverId = 'driver-no-vehicle'

      resourceOwnershipRepository.findByUserId.mockResolvedValue([])

      // Act
      const capacity = await service.getDriverCapacity(driverId, mockTenantId)

      // Assert
      expect(capacity).toBe(0)
    })
  })
})
