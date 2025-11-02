/**
 * DTOs for ABAC Policy endpoints
 * T225-226: Phase 10 - ABAC Policy Management API
 */

import { IsString, IsNotEmpty, IsInt, IsBoolean, IsOptional, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum AbacPolicyEffectDto {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
}

export enum AbacOperatorDto {
  EQUALS = 'eq',
  NOT_EQUALS = 'neq',
  IN = 'in',
  NOT_IN = 'not_in',
  GREATER_THAN = 'gt',
  GREATER_THAN_EQUAL = 'gte',
  LESS_THAN = 'lt',
  LESS_THAN_EQUAL = 'lte',
  CONTAINS = 'contains',
  NOT_CONTAINS = 'not_contains',
}

export class AbacConditionRuleDto {
  @ApiProperty({ example: 'user.facility', description: 'Attribute path using dot notation' })
  @IsString()
  @IsNotEmpty()
  attribute: string;

  @ApiProperty({ enum: AbacOperatorDto, example: 'eq' })
  @IsEnum(AbacOperatorDto)
  operator: AbacOperatorDto;

  @ApiProperty({ example: 'facility-123', description: 'Value to compare against' })
  value: any;
}

export class AbacConditionsDto {
  @ApiProperty({ enum: ['AND', 'OR'], example: 'AND' })
  @IsString()
  @IsNotEmpty()
  operator: 'AND' | 'OR';

  @ApiProperty({ type: [AbacConditionRuleDto] })
  @ValidateNested({ each: true })
  @Type(() => AbacConditionRuleDto)
  rules: AbacConditionRuleDto[];
}

export class CreatePolicyDto {
  @ApiProperty({ example: 'FIR Facility Scoping', description: 'Policy name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'fir', description: 'Resource type this policy applies to' })
  @IsString()
  @IsNotEmpty()
  resourceType: string;

  @ApiProperty({ enum: AbacPolicyEffectDto, example: 'ALLOW', description: 'Policy effect' })
  @IsEnum(AbacPolicyEffectDto)
  effect: AbacPolicyEffectDto;

  @ApiProperty({ type: AbacConditionsDto })
  @ValidateNested()
  @Type(() => AbacConditionsDto)
  conditions: AbacConditionsDto;

  @ApiProperty({ example: 100, description: 'Priority (lower = higher priority)', default: 100 })
  @IsInt()
  @IsOptional()
  priority?: number;

  @ApiProperty({ example: 'Allow FIR read if user facility matches FIR producer facility', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}

export class PolicyResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  resourceType: string;

  @ApiProperty({ enum: AbacPolicyEffectDto })
  effect: AbacPolicyEffectDto;

  @ApiProperty()
  conditions: AbacConditionsDto;

  @ApiProperty()
  priority: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
