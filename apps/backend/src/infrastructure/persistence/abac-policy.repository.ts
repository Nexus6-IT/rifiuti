/**
 * AbacPolicyRepository Implementation
 * T222-224: Phase 10 - ABAC Policy Engine
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AbacPolicy, AbacPolicyEffect } from '../../domain/identity-access/abac/abac-policy.entity';
import { AbacPolicyRepository } from '../../domain/identity-access/abac/abac-policy.repository.interface';

@Injectable()
export class PrismaAbacPolicyRepository implements AbacPolicyRepository {
  private readonly logger = new Logger(PrismaAbacPolicyRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findActiveByResourceType(resourceType: string): Promise<AbacPolicy[]> {
    const policies = await this.prisma.abacPolicy.findMany({
      where: {
        resourceType,
        isActive: true,
      },
      orderBy: {
        priority: 'asc', // Lower number = higher priority
      },
    });

    return policies.map(this.toDomain);
  }

  async findAllActive(): Promise<AbacPolicy[]> {
    const policies = await this.prisma.abacPolicy.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        priority: 'asc',
      },
    });

    return policies.map(this.toDomain);
  }

  async save(policy: AbacPolicy): Promise<void> {
    await this.prisma.abacPolicy.create({
      data: {
        id: policy.id,
        name: policy.name,
        resourceType: policy.resourceType,
        effect: policy.effect,
        conditions: policy.conditions as any,
        priority: policy.priority,
        isActive: policy.isActive,
        description: policy.description,
        createdBy: policy.createdBy,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      },
    });

    this.logger.log(`Created ABAC policy: ${policy.name} (${policy.id})`);
  }

  async findById(id: string): Promise<AbacPolicy | null> {
    const policy = await this.prisma.abacPolicy.findUnique({
      where: { id },
    });

    return policy ? this.toDomain(policy) : null;
  }

  async update(policy: AbacPolicy): Promise<void> {
    await this.prisma.abacPolicy.update({
      where: { id: policy.id },
      data: {
        name: policy.name,
        resourceType: policy.resourceType,
        effect: policy.effect,
        conditions: policy.conditions as any,
        priority: policy.priority,
        isActive: policy.isActive,
        description: policy.description,
        updatedAt: policy.updatedAt,
      },
    });

    this.logger.log(`Updated ABAC policy: ${policy.name} (${policy.id})`);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.abacPolicy.delete({
      where: { id },
    });

    this.logger.log(`Deleted ABAC policy: ${id}`);
  }

  private toDomain(raw: any): AbacPolicy {
    return AbacPolicy.reconstitute({
      id: raw.id,
      name: raw.name,
      resourceType: raw.resourceType,
      effect: raw.effect as AbacPolicyEffect,
      conditions: raw.conditions,
      priority: raw.priority,
      isActive: raw.isActive,
      description: raw.description,
      createdBy: raw.createdBy,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}
