/**
 * Create FIR DTO - Request validation
 */

import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, IsEnum } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'

export class RifiutoDto {
  @ApiProperty({ example: '13 02 05*', description: 'Codice CER del rifiuto' })
  @IsString()
  @IsNotEmpty()
  cerCode: string

  @ApiProperty({ example: 120, description: 'Quantità dichiarata', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  quantita: number

  @ApiPropertyOptional({
    enum: UnitaMisura,
    default: UnitaMisura.KG,
    description: 'Unità di misura',
  })
  @IsEnum(UnitaMisura)
  @IsOptional()
  unitaMisura?: UnitaMisura

  @ApiPropertyOptional({ example: 'Liquido', description: 'Stato fisico del rifiuto' })
  @IsString()
  @IsOptional()
  statoFisico?: string

  @ApiPropertyOptional({
    example: 'HP14',
    description: 'Caratteristiche di pericolo (HP codes)',
  })
  @IsString()
  @IsOptional()
  caratteristichePericolo?: string
}

export class CreateFIRDto {
  @ApiProperty({
    example: 'tenant-uuid-producer',
    description: 'ID tenant produttore/detentore',
  })
  @IsString()
  @IsNotEmpty()
  produttoreId: string

  @ApiProperty({ type: RifiutoDto, description: 'Dettagli rifiuto' })
  rifiuto: RifiutoDto

  @ApiProperty({
    example: 'tenant-uuid-transporter',
    description: 'ID tenant trasportatore',
  })
  @IsString()
  @IsNotEmpty()
  trasportatoreId: string

  @ApiProperty({
    example: 'tenant-uuid-destination',
    description: 'ID tenant destinatario',
  })
  @IsString()
  @IsNotEmpty()
  destinatarioId: string
}
