import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

const ISO_CON_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

export class StrumentoInBattitoDto {
  @ApiProperty()
  @IsUUID('all')
  strumentoId!: string

  @ApiProperty({ enum: ['OK', 'ERRORE', 'NON_CONFIGURATO'] })
  @IsIn(['OK', 'ERRORE', 'NON_CONFIGURATO'])
  stato!: 'OK' | 'ERRORE' | 'NON_CONFIGURATO'

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ultimoErrore?: string
}

/** Corpo di `POST /agenti-pesa/battito` (D8). */
export class BattitoDto {
  @ApiProperty({ maxLength: 30 })
  @IsString()
  @MaxLength(30)
  versione!: string

  @ApiProperty({ description: 'Ora del PC dell’agente, ISO 8601 con offset' })
  @IsString()
  @Matches(ISO_CON_OFFSET, { message: 'oraAgente deve essere ISO 8601 con offset.' })
  oraAgente!: string

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  codaInAttesa!: number

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  lettureScartate!: number

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  ultimaSequenza!: number

  @ApiProperty({ type: [StrumentoInBattitoDto], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StrumentoInBattitoDto)
  strumenti!: StrumentoInBattitoDto[]
}
