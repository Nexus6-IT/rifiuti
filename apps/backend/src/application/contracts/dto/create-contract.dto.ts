import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  IsDateString,
  IsUUID,
  Max,
  Min,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PAYMENT_TERMS, BILLING_FREQUENCIES } from '../contract-vocabulary'

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
  @IsUUID()
  producerId: string

  @ApiProperty({
    description: 'ID registro controparte (trasportatore/destinatario/intermediario)',
  })
  @IsUUID()
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
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'basePrice deve essere un numero con al massimo 2 decimali' }
  )
  @IsOptional()
  @Min(0, { message: 'basePrice non può essere negativo' })
  @Max(99999999.99, { message: 'basePrice non può superare 99.999.999,99' })
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

  @ApiPropertyOptional({ enum: PAYMENT_TERMS, example: 'net_30' })
  @IsIn(PAYMENT_TERMS as readonly string[])
  @IsOptional()
  paymentTerms?: string

  @ApiPropertyOptional({ enum: BILLING_FREQUENCIES, example: 'monthly' })
  @IsIn(BILLING_FREQUENCIES as readonly string[])
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
