/**
 * PoliciesController
 * T225-226: Phase 10 - ABAC Policy Management API
 *
 * Endpoints:
 * - POST /api/v1/policies (T225)
 * - GET /api/v1/policies (T226)
 */

import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Logger,
  HttpStatus,
  HttpCode,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { CreatePolicyDto, PolicyResponseDto, AbacPolicyEffectDto } from './dto/create-policy.dto';
import { AbacPolicyRepository } from '../../domain/identity-access/abac/abac-policy.repository.interface';
import { AbacPolicy, AbacPolicyEffect, AbacOperator } from '../../domain/identity-access/abac/abac-policy.entity';
import { Inject } from '@nestjs/common';

@ApiTags('Policies (ABAC)')
@ApiBearerAuth()
@Controller('policies')
@UseGuards(JwtAuthGuard)
export class PoliciesController {
  private readonly logger = new Logger(PoliciesController.name);

  constructor(
    @Inject('AbacPolicyRepository')
    private readonly policyRepository: AbacPolicyRepository,
  ) {}

  /**
   * T225: Create ABAC Policy
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('policies:create:all')
  @ApiOperation({ summary: 'Create a new ABAC policy (admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Policy created successfully',
    type: PolicyResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async createPolicy(
    @Body() dto: CreatePolicyDto,
    @Request() req: any,
  ): Promise<PolicyResponseDto> {
    const { userId } = req.user;

    this.logger.log(`Creating ABAC policy: ${dto.name} by user ${userId}`);

    // Map DTO to domain entity
    const policy = AbacPolicy.create({
      name: dto.name,
      resourceType: dto.resourceType,
      effect: dto.effect === AbacPolicyEffectDto.ALLOW ? AbacPolicyEffect.ALLOW : AbacPolicyEffect.DENY,
      conditions: {
        operator: dto.conditions.operator,
        rules: dto.conditions.rules.map((rule) => ({
          attribute: rule.attribute,
          operator: rule.operator as unknown as AbacOperator,
          value: rule.value,
        })),
      },
      priority: dto.priority || 100,
      isActive: true,
      description: dto.description,
      createdBy: userId,
    });

    await this.policyRepository.save(policy);

    return this.toPolicyResponse(policy);
  }

  /**
   * T226: List all ABAC Policies
   */
  @Get()
  @RequirePermission('policies:read:all')
  @ApiOperation({ summary: 'List all ABAC policies' })
  @ApiResponse({
    status: 200,
    description: 'Policies retrieved successfully',
    type: [PolicyResponseDto],
  })
  async listPolicies(): Promise<PolicyResponseDto[]> {
    const policies = await this.policyRepository.findAllActive();
    return policies.map(this.toPolicyResponse);
  }

  /**
   * Additional endpoints for completeness
   */
  @Get(':id')
  @RequirePermission('policies:read:all')
  @ApiOperation({ summary: 'Get policy by ID' })
  async getPolicy(@Param('id') id: string): Promise<PolicyResponseDto> {
    const policy = await this.policyRepository.findById(id);
    if (!policy) {
      throw new Error('Policy not found');
    }
    return this.toPolicyResponse(policy);
  }

  @Patch(':id/deactivate')
  @RequirePermission('policies:update:all')
  @ApiOperation({ summary: 'Deactivate a policy' })
  async deactivatePolicy(@Param('id') id: string): Promise<PolicyResponseDto> {
    const policy = await this.policyRepository.findById(id);
    if (!policy) {
      throw new Error('Policy not found');
    }
    policy.deactivate();
    await this.policyRepository.update(policy);
    return this.toPolicyResponse(policy);
  }

  @Patch(':id/activate')
  @RequirePermission('policies:update:all')
  @ApiOperation({ summary: 'Activate a policy' })
  async activatePolicy(@Param('id') id: string): Promise<PolicyResponseDto> {
    const policy = await this.policyRepository.findById(id);
    if (!policy) {
      throw new Error('Policy not found');
    }
    policy.activate();
    await this.policyRepository.update(policy);
    return this.toPolicyResponse(policy);
  }

  @Delete(':id')
  @RequirePermission('policies:delete:all')
  @ApiOperation({ summary: 'Delete a policy' })
  async deletePolicy(@Param('id') id: string): Promise<void> {
    await this.policyRepository.delete(id);
  }

  private toPolicyResponse(policy: AbacPolicy): PolicyResponseDto {
    return {
      id: policy.id,
      name: policy.name,
      resourceType: policy.resourceType,
      effect: policy.effect === AbacPolicyEffect.ALLOW ? AbacPolicyEffectDto.ALLOW : AbacPolicyEffectDto.DENY,
      conditions: policy.conditions as any,
      priority: policy.priority,
      isActive: policy.isActive,
      description: policy.description,
      createdBy: policy.createdBy,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }
}
