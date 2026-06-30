import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { ConsultantTenantAssociationRepository } from '../../domain/identity-access/consultant-tenant-association.repository.interface'
import { ConsultantTenantAssociation } from '../../domain/identity-access/consultant-tenant-association.entity'

/**
 * PrismaConsultantTenantAssociationRepository
 * Prisma implementation of ConsultantTenantAssociationRepository
 * Per plan.md: PostgreSQL with schema-per-tenant isolation
 *
 * Performance considerations:
 * - Index on (consultantUserId, tenantId) for fast lookups
 * - Index on (consultantUserId, isActive) for active association queries
 * - No caching (associations change rarely, cache complexity not worth it)
 */
@Injectable()
export class PrismaConsultantTenantAssociationRepository
  implements ConsultantTenantAssociationRepository
{
  private readonly logger = new Logger(PrismaConsultantTenantAssociationRepository.name)

  constructor(private readonly prisma: PrismaService) {}

  async save(association: ConsultantTenantAssociation): Promise<ConsultantTenantAssociation> {
    const data = association.toPersistence()

    const saved = await this.prisma.consultantTenantAssociation.upsert({
      where: { id: data.id },
      update: {
        isActive: data.isActive,
        expiresAt: data.expiresAt,
      },
      create: {
        id: data.id,
        consultantUserId: data.consultantUserId,
        tenantId: data.tenantId,
        roleId: data.roleId,
        addedBy: data.addedBy,
        addedAt: data.addedAt,
        expiresAt: data.expiresAt,
        isActive: data.isActive,
      },
    })

    this.logger.debug(
      `Saved consultant association ${saved.id} for consultant ${saved.consultantUserId} to tenant ${saved.tenantId}`
    )

    return ConsultantTenantAssociation.fromPersistence(saved)
  }

  async findById(id: string): Promise<ConsultantTenantAssociation | null> {
    const association = await this.prisma.consultantTenantAssociation.findUnique({
      where: { id },
    })

    if (!association) {
      return null
    }

    return ConsultantTenantAssociation.fromPersistence(association)
  }

  async findAllByConsultant(consultantUserId: string): Promise<ConsultantTenantAssociation[]> {
    const associations = await this.prisma.consultantTenantAssociation.findMany({
      where: {
        consultantUserId,
      },
      orderBy: {
        addedAt: 'desc', // Most recently added first
      },
    })

    this.logger.debug(
      `Found ${associations.length} associations for consultant ${consultantUserId}`
    )

    return associations.map((a: any) => ConsultantTenantAssociation.fromPersistence(a))
  }

  async findActiveByConsultantAndTenant(
    consultantUserId: string,
    tenantId: string
  ): Promise<ConsultantTenantAssociation | null> {
    const now = new Date()

    const association = await this.prisma.consultantTenantAssociation.findFirst({
      where: {
        consultantUserId,
        tenantId,
        isActive: true,
        OR: [
          { expiresAt: null }, // Never expires
          { expiresAt: { gt: now } }, // Not yet expired
        ],
      },
    })

    if (!association) {
      this.logger.debug(
        `No active association found for consultant ${consultantUserId} with tenant ${tenantId}`
      )
      return null
    }

    return ConsultantTenantAssociation.fromPersistence(association)
  }

  async findAllByTenant(tenantId: string): Promise<ConsultantTenantAssociation[]> {
    const associations = await this.prisma.consultantTenantAssociation.findMany({
      where: {
        tenantId,
      },
      orderBy: {
        addedAt: 'desc',
      },
    })

    this.logger.debug(`Found ${associations.length} consultant associations for tenant ${tenantId}`)

    return associations.map((a: any) => ConsultantTenantAssociation.fromPersistence(a))
  }

  async deactivate(id: string): Promise<ConsultantTenantAssociation> {
    const association = await this.findById(id)

    if (!association) {
      throw new Error(`Consultant association ${id} not found`)
    }

    association.deactivate()

    return await this.save(association)
  }

  async reactivate(id: string): Promise<ConsultantTenantAssociation> {
    const association = await this.findById(id)

    if (!association) {
      throw new Error(`Consultant association ${id} not found`)
    }

    association.reactivate()

    return await this.save(association)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.consultantTenantAssociation.delete({
      where: { id },
    })

    this.logger.debug(`Deleted consultant association ${id}`)
  }

  async countActiveByConsultant(consultantUserId: string): Promise<number> {
    const now = new Date()

    const count = await this.prisma.consultantTenantAssociation.count({
      where: {
        consultantUserId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    })

    return count
  }

  async findExpiringSoon(daysThreshold: number = 30): Promise<ConsultantTenantAssociation[]> {
    const now = new Date()
    const thresholdDate = new Date()
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold)

    const associations = await this.prisma.consultantTenantAssociation.findMany({
      where: {
        isActive: true,
        expiresAt: {
          gte: now, // Not yet expired
          lte: thresholdDate, // But expires within threshold
        },
      },
      orderBy: {
        expiresAt: 'asc', // Soonest expiration first
      },
    })

    this.logger.debug(
      `Found ${associations.length} associations expiring within ${daysThreshold} days`
    )

    return associations.map((a: any) => ConsultantTenantAssociation.fromPersistence(a))
  }
}
