/**
 * Create FIR DTO - Request validation
 */

import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  IsEnum,
  IsInt,
  IsArray,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { TipoTratta } from '../../../domain/fir/aggregates/fir.aggregate'

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

export class TrasportatoreAggiuntivoDto {
  @ApiProperty({
    example: 'trasportatore-uuid',
    description: 'ID del trasportatore (registro) per questa tratta intermodale',
  })
  @IsString()
  @IsNotEmpty()
  trasportatoreId: string

  @ApiProperty({
    enum: TipoTratta,
    example: TipoTratta.FERROVIARIA,
    description: 'Tipo di tratta (terrestre / ferroviaria / marittima)',
  })
  @IsEnum(TipoTratta)
  tipoTratta: TipoTratta

  @ApiProperty({
    example: 2,
    minimum: 1,
    description: 'Ordine della tratta nella sequenza del trasporto intermodale (1-based)',
  })
  @IsInt()
  @Min(1)
  ordine: number
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
  @ValidateNested()
  @Type(() => RifiutoDto)
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

  @ApiPropertyOptional({
    type: [TrasportatoreAggiuntivoDto],
    description:
      'Trasportatori aggiuntivi per trasporto intermodale (oltre al trasportatore ' +
      'principale). Ordinati per `ordine`. Omettere per un FIR mono-trasportatore.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrasportatoreAggiuntivoDto)
  trasportatoriAggiuntivi?: TrasportatoreAggiuntivoDto[]
}
