import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ResourceOwnership } from '../../domain/identity-access/resource-ownership.entity';
import { ResourceOwnershipRepository } from '../../domain/identity-access/resource-ownership.repository.interface';

/**
 * Prisma ResourceOwnership Repository Implementation
 * T184: Infrastructure layer for User Story 6 - Task Assignment Automation
 *
 * Purpose: Implement ResourceOwnership persistence using Prisma ORM
 *
 * Requirements from spec.md FR-029-032:
 * - Fast lookups for task assignment routing (<10ms)
 * - Support filtering by certifications, zones, capacity
 * - Tenant isolation for all queries
 * - Audit trail preservation
 *
 * Requirements from plan.md:
 * - Use database indexes for performance
 * - Support complex metadata queries (JSON)
 * - Handle concurrent assignment conflicts
 * - Efficient expiration checks
 */
@Injectable()
export class PrismaResourceOwnershipRepository
  implements ResourceOwnershipRepository
{
  private readonly logger = new Logger(PrismaResourceOwnershipRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(ownership: ResourceOwnership): Promise<ResourceOwnership> {
    const data = ownership.toPersistence();

    const saved = await this.prisma.resourceOwnership.upsert({
      where: {
        id: data.id,
      },
      update: {
        isActive: data.isActive,
        revokedBy: data.revokedBy,
        revokedAt: data.revokedAt,
        revocationReason: data.revocationReason,
        expiresAt: data.expiresAt,
        metadata: data.metadata as any,
      },
      create: {
        id: data.id,
        userId: data.userId,
        tenantId: data.tenantId,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        assignedBy: data.assignedBy,
        assignedAt: data.assignedAt,
        expiresAt: data.expiresAt,
        isActive: data.isActive,
        revokedBy: data.revokedBy,
        revokedAt: data.revokedAt,
        revocationReason: data.revocationReason,
        reason: data.reason,
        metadata: data.metadata as any,
      },
    });

    this.logger.debug(`Saved ResourceOwnership ${saved.id}`);

    return ResourceOwnership.fromPersistence(saved);
  }

  async findById(
    id: string,
    tenantId: string,
  ): Promise<ResourceOwnership | null> {
    const found = await this.prisma.resourceOwnership.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!found) {
      return null;
    }

    return ResourceOwnership.fromPersistence(found);
  }

  async findActiveByTenant(
    tenantId: string,
    resourceType?: string,
  ): Promise<ResourceOwnership[]> {
    const where: any = {
      tenantId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    };

    if (resourceType) {
      where.resourceType = resourceType;
    }

    const ownerships = await this.prisma.resourceOwnership.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
    });

    return ownerships.map((o: any) => ResourceOwnership.fromPersistence(o));
  }

  async findByUserId(
    userId: string,
    tenantId: string,
    activeOnly: boolean = false,
  ): Promise<ResourceOwnership[]> {
    const where: any = {
      userId,
      tenantId,
    };

    if (activeOnly) {
      where.isActive = true;
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ];
    }

    const ownerships = await this.prisma.resourceOwnership.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
    });

    return ownerships.map((o: any) => ResourceOwnership.fromPersistence(o));
  }

  async findByResourceId(
    resourceId: string,
    tenantId: string,
    activeOnly: boolean = false,
  ): Promise<ResourceOwnership[]> {
    const where: any = {
      resourceId,
      tenantId,
    };

    if (activeOnly) {
      where.isActive = true;
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ];
    }

    const ownerships = await this.prisma.resourceOwnership.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
    });

    return ownerships.map((o: any) => ResourceOwnership.fromPersistence(o));
  }

  async findActiveVehicleAssignments(
    tenantId: string,
    requiredCertifications?: string[],
    zone?: string,
  ): Promise<ResourceOwnership[]> {
    const where: any = {
      tenantId,
      resourceType: 'vehicle',
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    };

    // Note: Prisma doesn't natively support JSON array containment in TypeScript
    // For production, this should be optimized with raw SQL or database functions
    let ownerships = await this.prisma.resourceOwnership.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
    });

    // Client-side filtering for certification and zone matching
    if (requiredCertifications && requiredCertifications.length > 0) {
      ownerships = ownerships.filter((o: any) => {
        const metadata = o.metadata as any;
        if (!metadata || !metadata.certifications) {
          return false;
        }

        const driverCerts = metadata.certifications as string[];
        return requiredCertifications.every((reqCert) =>
          driverCerts.includes(reqCert),
        );
      });
    }

    if (zone) {
      ownerships = ownerships.filter((o: any) => {
        const metadata = o.metadata as any;
        return metadata && metadata.zone === zone;
      });
    }

    return ownerships.map((o: any) => ResourceOwnership.fromPersistence(o));
  }

  async findExpiringAssignments(
    tenantId: string,
    withinDays: number,
  ): Promise<ResourceOwnership[]> {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + withinDays);

    const ownerships = await this.prisma.resourceOwnership.findMany({
      where: {
        tenantId,
        isActive: true,
        expiresAt: {
          gte: now,
          lte: futureDate,
        },
      },
      orderBy: { expiresAt: 'asc' },
    });

    return ownerships.map((o: any) => ResourceOwnership.fromPersistence(o));
  }

  async hasActiveAssignment(
    userId: string,
    tenantId: string,
    resourceType: string,
  ): Promise<boolean> {
    const count = await this.prisma.resourceOwnership.count({
      where: {
        userId,
        tenantId,
        resourceType,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    return count > 0;
  }

  async getAssignmentHistory(
    userId: string,
    tenantId: string,
    limit: number = 50,
  ): Promise<ResourceOwnership[]> {
    const ownerships = await this.prisma.resourceOwnership.findMany({
      where: {
        userId,
        tenantId,
      },
      orderBy: { assignedAt: 'desc' },
      take: limit,
    });

    return ownerships.map((o: any) => ResourceOwnership.fromPersistence(o));
  }

  async deactivateAllForUser(
    userId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
  ): Promise<number> {
    const result = await this.prisma.resourceOwnership.updateMany({
      where: {
        userId,
        tenantId,
        isActive: true,
      },
      data: {
        isActive: false,
        revokedBy,
        revokedAt: new Date(),
        revocationReason: reason,
      },
    });

    this.logger.log(
      `Deactivated ${result.count} assignments for user ${userId}`,
    );

    return result.count;
  }

  async deactivateAllForResource(
    resourceId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
  ): Promise<number> {
    const result = await this.prisma.resourceOwnership.updateMany({
      where: {
        resourceId,
        tenantId,
        isActive: true,
      },
      data: {
        isActive: false,
        revokedBy,
        revokedAt: new Date(),
        revocationReason: reason,
      },
    });

    this.logger.log(
      `Deactivated ${result.count} assignments for resource ${resourceId}`,
    );

    return result.count;
  }

  async delete(id: string, tenantId: string): Promise<void> {
    await this.prisma.resourceOwnership.delete({
      where: {
        id,
        // Note: Prisma doesn't support compound where conditions in delete
        // This should be validated before calling
      },
    });

    this.logger.debug(`Deleted ResourceOwnership ${id}`);
  }
}
