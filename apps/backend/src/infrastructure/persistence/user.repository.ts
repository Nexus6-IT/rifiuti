import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { User } from '../../domain/auth/user.entity'
import { ITenantRepository } from '../../domain/shared/repository.interface'

/**
 * User Repository
 *
 * Persists User aggregate using Prisma ORM.
 * Handles SPID attributes serialization/deserialization.
 *
 * Features:
 * - Tenant isolation (users belong to tenants)
 * - SPID attributes stored as JSON
 * - Fiscal code indexing for fast lookup
 * - Role management
 */
@Injectable()
export class UserRepository implements ITenantRepository<User> {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenantId?: string
  ) {}

  getTenantId(): string {
    return this.tenantId || ''
  }

  /**
   * Save new user
   */
  async save(user: User): Promise<User> {
    const _spidAttributes = user.getSpidAttributes()
    const roles = user.getRoles()
    const primaryRole = roles && roles.length > 0 ? roles[0] : 'OPERATOR'

    const data = {
      id: user.getId(),
      keycloakId: user.getId(), // TODO: Use actual Keycloak ID
      fiscalCode: user.getFiscalCode(),
      firstName: user.getFirstName(),
      lastName: user.getLastName(),
      email: user.getEmail(),
      tenantId: user.getTenantId(),
      role: primaryRole, // User schema has 'role' (singular), not 'roles'
      // TODO: isActive field doesn't exist in User model
      // TODO: SPID fields don't exist in User model
      createdAt: user.getCreatedAt(),
      updatedAt: user.getUpdatedAt(),
    }

    await this.prisma.user.create({ data } as any)

    return user
  }

  /**
   * Update existing user
   */
  async update(id: string, user: User): Promise<User> {
    const _spidAttributes = user.getSpidAttributes()
    const roles = user.getRoles()
    const primaryRole = roles && roles.length > 0 ? roles[0] : 'OPERATOR'

    const data = {
      firstName: user.getFirstName(),
      lastName: user.getLastName(),
      email: user.getEmail(),
      role: primaryRole, // User schema has 'role' (singular), not 'roles'
      // TODO: isActive field doesn't exist in User model
      // TODO: SPID fields don't exist in User model
      updatedAt: new Date(),
    }

    await this.prisma.user.update({
      where: { id },
      data,
    } as any)

    return user
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    const record = (await this.prisma.user.findUnique({
      where: { id },
    })) as any

    if (!record) {
      return null
    }

    return this.toDomain(record)
  }

  /**
   * Find user by fiscal code
   * Note: fiscalCode is not unique globally, only per tenant
   */
  async findByFiscalCode(fiscalCode: string): Promise<User | null> {
    const record = (await this.prisma.user.findFirst({
      where: {
        fiscalCode: fiscalCode.toUpperCase(),
        tenantId: this.tenantId,
      },
    })) as any

    if (!record) {
      return null
    }

    return this.toDomain(record)
  }

  /**
   * Find user by email
   * Note: email is not unique globally
   */
  async findByEmail(email: string): Promise<User | null> {
    const record = (await this.prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        tenantId: this.tenantId,
      },
    })) as any

    if (!record) {
      return null
    }

    return this.toDomain(record)
  }

  /**
   * Find all users for a tenant
   */
  async findByTenant(criteria?: any): Promise<User[]> {
    const where: any = {
      tenantId: this.tenantId,
      ...criteria,
    }

    const records = (await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })) as any[]

    return records.map(r => this.toDomain(r))
  }

  /**
   * Find all users (admin only)
   */
  async findAll(criteria?: any): Promise<User[]> {
    const records = (await this.prisma.user.findMany({
      where: criteria,
      orderBy: { createdAt: 'desc' },
    })) as any[]

    return records.map(r => this.toDomain(r))
  }

  /**
   * Find users with pagination
   */
  async findPaginated(
    limit: number,
    offset: number,
    criteria?: any
  ): Promise<{ data: User[]; total: number }> {
    const where = criteria || {}

    const [records, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }) as any,
      this.prisma.user.count({ where }) as any,
    ])

    return {
      data: records.map((r: any) => this.toDomain(r)),
      total,
    }
  }

  /**
   * Check if user exists
   */
  async exists(id: string): Promise<boolean> {
    const count = (await this.prisma.user.count({
      where: { id },
    })) as any

    return count > 0
  }

  /**
   * Count users
   */
  async count(criteria?: any): Promise<number> {
    return this.prisma.user.count({
      where: criteria,
    }) as any
  }

  /**
   * Delete user (hard delete)
   * TODO: isActive field doesn't exist - using hard delete instead
   */
  async delete(id: string): Promise<boolean> {
    await this.prisma.user.delete({
      where: { id },
    })

    return true
  }

  /**
   * Convert Prisma record to domain entity
   */
  private toDomain(record: any): User {
    // TODO: SPID attributes don't exist in User model
    // Reconstruct SPID attributes if present
    // let spidAttributes: SPIDAttributes | undefined;

    // if (record.spidLevel && record.spidLevel > 0) {
    //   spidAttributes = SPIDAttributes.create({
    //     fiscalCode: record.fiscalCode,
    //     firstName: record.firstName,
    //     lastName: record.lastName,
    //     email: record.email,
    //     spidLevel: record.spidLevel,
    //     issuer: record.spidIssuer || 'https://unknown',
    //     sessionId: record.spidSessionId || 'unknown',
    //     authenticatedAt: record.spidAuthenticatedAt || new Date(),
    //   });
    // }

    return User.create({
      id: record.id,
      fiscalCode: record.fiscalCode,
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.email,
      tenantId: record.tenantId,
      spidAttributes: undefined,
      roles: record.role ? [record.role] : [], // Convert singular 'role' to 'roles' array
      isActive: true, // TODO: isActive field doesn't exist in User model
    })
  }
}
