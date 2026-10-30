import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  NotImplementedException,
} from '@nestjs/common'
import { ResourceOwnershipRepository } from '../../domain/identity-access/resource-ownership.repository.interface'
import { FIRRepository } from '../../domain/fir/fir.repository'
import { FIR } from '../../domain/fir/fir.aggregate'

/**
 * Dati di assegnazione che il motore di routing si aspetta sul FIR. L'aggregate FIR non li
 * espone ancora (nessun autista, zona o certificazione richiesta): restano opzionali, cosi' la
 * lettura e' tipata senza cast a any.
 */
interface DatiAssegnazioneFir {
  requiredCertifications?: string[]
  pickupZone?: string
  estimatedWeight?: number
  assignedDriverId?: string
}

function datiAssegnazione(fir: FIR): DatiAssegnazioneFir {
  return fir as FIR & DatiAssegnazioneFir
}

/**
 * TaskAssignmentService
 * T185: Service for User Story 6 - Task Assignment Automation
 *
 * Purpose: Automatically route FIR pickup requests to qualified drivers
 *
 * Requirements from spec.md FR-029-032:
 * - Match drivers based on certifications (ADR, Hazmat, etc.)
 * - Respect zone assignments
 * - Consider vehicle capacity and current workload
 * - Balance workload across available drivers
 * - Support manual override with warnings
 *
 * Requirements from plan.md:
 * - Rule-based assignment engine
 * - Ranking algorithm for multiple qualified drivers
 * - Fallback to manual assignment if no qualified driver
 * - Audit trail for all assignments
 * - <10ms assignment decision time
 */

export interface QualifiedDriver {
  userId: string
  resourceId: string // vehicle ID
  certifications: string[]
  zone: string
  capacity: number
  currentWorkload: number
  availableCapacity: number
  score: number // Ranking score for selection
}

export interface AssignmentResult {
  assignedDriverId: string
  assignedBy: string
  assignmentMethod: 'automatic' | 'manual'
  priority?: string
  warnings?: string[]
  previousDriverId?: string
  reason?: string
  auditTrail?: {
    action: string
    performedBy: string
    reason?: string
    timestamp: Date
  }
}

@Injectable()
export class TaskAssignmentService {
  private readonly logger = new Logger(TaskAssignmentService.name)

  constructor(
    @Inject('ResourceOwnershipRepository')
    private readonly resourceOwnershipRepository: ResourceOwnershipRepository,
    @Inject('FIRRepository')
    private readonly firRepository: FIRRepository
  ) {}

  /**
   * L'aggregate FIR non ha un autista assegnato: non esistono ne' un metodo di dominio ne' una
   * colonna in cui scriverlo. La vecchia chiamata a un `assignDriver` inesistente lanciava un
   * TypeError generico prima di qualsiasi save; ora l'errore e' esplicito (501) e non si scrive
   * nulla. Quando il dominio avra' il concetto di autista, la scrittura dovra' usare
   * `save(fir, { verificaVersione: true })`.
   */
  private assegnaAutista(firId: string, driverId: string, assignedBy: string): never {
    this.logger.warn(
      `Assegnazione autista ${driverId} al FIR ${firId} (richiesta di ${assignedBy}) non supportata dal dominio`
    )
    throw new NotImplementedException(
      'L\x27assegnazione di un autista a un FIR non e\x27 ancora supportata: il FIR non ha un campo autista'
    )
  }

  /**
   * Find all qualified drivers for a specific FIR
   * Returns drivers ranked by suitability
   */
  async findQualifiedDrivers(firId: string, tenantId: string): Promise<QualifiedDriver[]> {
    // Step 1: Load FIR details
    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw new NotFoundException('FIR not found')
    }

    const dati = datiAssegnazione(fir)
    const requiredCertifications = dati.requiredCertifications || []
    const pickupZone = dati.pickupZone
    const estimatedWeight = dati.estimatedWeight || 0

    // Step 2: Load all active vehicle assignments
    const activeAssignments = await this.resourceOwnershipRepository.findActiveByTenant(
      tenantId,
      'vehicle'
    )

    // Step 3: Filter and rank qualified drivers
    const qualifiedDrivers: QualifiedDriver[] = []

    for (const assignment of activeAssignments) {
      // Skip expired/inactive
      if (!assignment.isActiveAndNotExpired()) {
        continue
      }

      const metadata = assignment.metadata || {}
      const driverCerts = metadata.certifications || []
      const driverZone = metadata.zone
      const vehicleCapacity = metadata.capacity || 0

      // Check certifications
      const hasCertifications = requiredCertifications.every((reqCert: string) =>
        driverCerts.includes(reqCert)
      )

      if (!hasCertifications && requiredCertifications.length > 0) {
        continue
      }

      // Check zone
      if (pickupZone && driverZone !== pickupZone) {
        continue
      }

      // Check capacity
      const currentWorkload = await this.firRepository.getCurrentWorkloadByDriver(
        assignment.userId,
        tenantId
      )

      const availableCapacity = vehicleCapacity - currentWorkload

      if (availableCapacity < estimatedWeight) {
        continue
      }

      // Calculate ranking score
      const score = this.calculateDriverScore(
        {
          requiredCertifications: driverCerts,
          currentWorkload,
          availableCapacity,
          hasExactCertMatch: driverCerts.length === requiredCertifications.length,
        },
        requiredCertifications
      )

      qualifiedDrivers.push({
        userId: assignment.userId,
        resourceId: assignment.resourceId,
        certifications: driverCerts,
        zone: driverZone,
        capacity: vehicleCapacity,
        currentWorkload,
        availableCapacity,
        score,
      })
    }

    // Sort by score (highest first)
    qualifiedDrivers.sort((a, b) => b.score - a.score)

    return qualifiedDrivers
  }

  /**
   * Automatically assign FIR to best qualified driver
   */
  async autoAssignTask(
    firId: string,
    tenantId: string,
    assignedBy: string
  ): Promise<AssignmentResult> {
    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw new NotFoundException('FIR not found')
    }

    const qualifiedDrivers = await this.findQualifiedDrivers(firId, tenantId)

    if (qualifiedDrivers.length === 0) {
      throw new BadRequestException(
        'No qualified drivers available for this task. Please assign manually.'
      )
    }

    // Select best driver (highest score)
    const selectedDriver = qualifiedDrivers[0]

    return this.assegnaAutista(firId, selectedDriver.userId, assignedBy)
  }

  /**
   * Manually assign FIR to specific driver
   * Allows override with warnings if driver is not fully qualified
   */
  async manualAssignTask(
    firId: string,
    driverId: string,
    tenantId: string,
    assignedBy: string
  ): Promise<AssignmentResult> {
    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw new NotFoundException('FIR not found')
    }

    // Verify driver exists and has active vehicle assignment
    const driverAssignments = await this.resourceOwnershipRepository.findByUserId(
      driverId,
      tenantId,
      true
    )

    const vehicleAssignment = driverAssignments.find(
      a => a.resourceType === 'vehicle' && a.isActiveAndNotExpired()
    )

    if (!vehicleAssignment) {
      throw new NotFoundException('Driver not found or has no active vehicle assignment')
    }

    // Check qualifications and generate warnings
    const warnings: string[] = []
    const requiredCertifications = datiAssegnazione(fir).requiredCertifications || []
    const metadata = vehicleAssignment.metadata || {}
    const driverCerts = metadata.certifications || []

    // Check certifications
    const missingCerts = requiredCertifications.filter(
      (reqCert: string) => !driverCerts.includes(reqCert)
    )

    if (missingCerts.length > 0) {
      warnings.push(`Driver lacks required certifications: ${missingCerts.join(', ')}`)
    }

    // Check capacity
    const vehicleCapacity = metadata.capacity || 0
    const currentWorkload = await this.firRepository.getCurrentWorkloadByDriver(driverId, tenantId)

    const estimatedWeight = datiAssegnazione(fir).estimatedWeight || 0

    if (currentWorkload + estimatedWeight > vehicleCapacity) {
      throw new BadRequestException(
        `Vehicle capacity exceeded: ${currentWorkload + estimatedWeight}kg > ${vehicleCapacity}kg`
      )
    }

    return this.assegnaAutista(firId, driverId, assignedBy)
  }

  /**
   * Reassign FIR to different driver
   */
  async reassignTask(
    firId: string,
    newDriverId: string,
    tenantId: string,
    reassignedBy: string,
    reason: string
  ): Promise<AssignmentResult> {
    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw new NotFoundException('FIR not found')
    }

    const previousDriverId = datiAssegnazione(fir).assignedDriverId

    // Use manual assignment logic (includes validation)
    const result = await this.manualAssignTask(firId, newDriverId, tenantId, reassignedBy)

    this.logger.log(`Reassigned FIR ${firId} from ${previousDriverId} to ${newDriverId}: ${reason}`)

    return {
      ...result,
      previousDriverId,
      reason,
      auditTrail: {
        action: 'reassign',
        performedBy: reassignedBy,
        reason,
        timestamp: new Date(),
      },
    }
  }

  /**
   * Get current workload for a driver
   */
  async getDriverWorkload(driverId: string, tenantId: string): Promise<number> {
    return this.firRepository.getCurrentWorkloadByDriver(driverId, tenantId)
  }

  /**
   * Get vehicle capacity for a driver
   */
  async getDriverCapacity(driverId: string, tenantId: string): Promise<number> {
    const assignments = await this.resourceOwnershipRepository.findByUserId(
      driverId,
      tenantId,
      true
    )

    const vehicleAssignment = assignments.find(
      a => a.resourceType === 'vehicle' && a.isActiveAndNotExpired()
    )

    if (!vehicleAssignment) {
      return 0
    }

    const metadata = vehicleAssignment.metadata || {}
    return metadata.capacity || 0
  }

  /**
   * Calculate ranking score for driver selection
   * Higher score = better match
   */
  private calculateDriverScore(
    driver: {
      requiredCertifications: string[]
      currentWorkload: number
      availableCapacity: number
      hasExactCertMatch: boolean
    },
    requiredCertifications: string[]
  ): number {
    let score = 100

    // Prefer exact certification match
    if (driver.hasExactCertMatch && requiredCertifications.length > 0) {
      score += 20
    }

    // Prefer drivers with more available capacity
    const capacityRatio = driver.availableCapacity / (driver.currentWorkload + 1)
    score += Math.min(capacityRatio * 10, 30)

    // Prefer drivers with lower current workload
    const workloadPenalty = driver.currentWorkload / 100
    score -= Math.min(workloadPenalty, 20)

    return Math.max(score, 0)
  }
}
