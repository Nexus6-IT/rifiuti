import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  IsDateString,
  Min,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export enum CounterpartyTypeDto {
  TRANSPORTER = 'TRANSPORTER',
  DISPOSER = 'DISPOSER',
  BROKER = 'BROKER',
}

export enum ContractTypeDto {
  WASTE_DISPOSAL = 'WASTE_DISPOSAL',
  WASTE_TRANSPORT = 'WASTE_TRANSPORT',
  FULL_SERVICE = 'FULL_SERVICE',
  FRAMEWORK = 'FRAMEWORK',
}

export enum PricingModelDto {
  FLAT_RATE = 'FLAT_RATE',
  PAY_PER_LIFT = 'PAY_PER_LIFT',
  PAY_BY_WEIGHT = 'PAY_BY_WEIGHT',
  PAY_BY_VOLUME = 'PAY_BY_VOLUME',
  ZONE_BASED = 'ZONE_BASED',
  TIERED_VOLUME = 'TIERED_VOLUME',
  MINIMUM_GUARANTEE = 'MINIMUM_GUARANTEE',
  HYBRID = 'HYBRID',
}

export class CreateContractDto {
  @ApiProperty({ example: 'CTR-2026-001' })
  @IsString()
  @IsNotEmpty()
  contractNumber: string

  @ApiProperty({ description: 'ID registro produttore' })
  @IsString()
  @IsNotEmpty()
  producerId: string

  @ApiProperty({ description: 'ID registro controparte (trasportatore/destinatario/intermediario)' })
  @IsString()
  @IsNotEmpty()
  counterpartyId: string

  @ApiProperty({ enum: CounterpartyTypeDto })
  @IsEnum(CounterpartyTypeDto)
  counterpartyType: CounterpartyTypeDto

  @ApiProperty({ enum: ContractTypeDto })
  @IsEnum(ContractTypeDto)
  contractType: ContractTypeDto

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string

  @ApiProperty({ type: [String], example: ['150101', '150102'] })
  @IsArray()
  @IsString({ each: true })
  cerCodes: string[]

  @ApiProperty({ enum: PricingModelDto })
  @IsEnum(PricingModelDto)
  pricingModel: PricingModelDto

  @ApiPropertyOptional({ example: 120.5 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  basePrice?: number

  @ApiPropertyOptional({ example: 'ton' })
  @IsString()
  @IsOptional()
  unitOfMeasure?: string

  @ApiPropertyOptional({ description: 'Configurazione pricing (tier/zone/ecc.)' })
  @IsOptional()
  pricingConfig?: any

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  startDate: string

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsDateString()
  @IsOptional()
  endDate?: string

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  @Min(1)
  durationMonths?: number

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  autoRenew?: boolean

  @ApiPropertyOptional({ default: 60 })
  @IsInt()
  @IsOptional()
  @Min(0)
  renewalNoticeDays?: number

  @ApiPropertyOptional({ example: 'net_30' })
  @IsString()
  @IsOptional()
  paymentTerms?: string

  @ApiPropertyOptional({ example: 'monthly' })
  @IsString()
  @IsOptional()
  billingFrequency?: string
}

export class ChangeContractStatusDto {
  @ApiProperty({
    enum: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED'],
  })
  @IsEnum({
    DRAFT: 'DRAFT',
    PENDING_APPROVAL: 'PENDING_APPROVAL',
    ACTIVE: 'ACTIVE',
    SUSPENDED: 'SUSPENDED',
    EXPIRED: 'EXPIRED',
    TERMINATED: 'TERMINATED',
  })
  status: string
}
