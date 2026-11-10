import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'
import { Transform } from 'class-transformer'

export const CONSORZI_AMMESSI = ['CONOU', 'COBAT', 'COREPLA'] as const
const DATA = /^\d{4}-\d{2}-\d{2}$/

export class RegolaConsorzioDto {
  @ApiProperty({ enum: CONSORZI_AMMESSI })
  @IsIn(CONSORZI_AMMESSI, { message: 'Consorzio non valido.' })
  consorzio!: string

  @ApiProperty({ example: '13', description: '2 o 4 cifre = prefisso, 6 cifre = codice esatto.' })
  @IsString({ message: 'CER non valido.' })
  @MaxLength(20, { message: 'CER non valido.' })
  cer!: string

  @ApiPropertyOptional({ enum: ['CARICO', 'SCARICO'], nullable: true })
  @IsOptional()
  @IsIn(['CARICO', 'SCARICO'], { message: 'Verso non valido.' })
  verso?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString({ message: 'Causale non valida.' })
  @MaxLength(100, { message: 'Causale non valida.' })
  causaleCodice?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('all', { message: 'Registro non valido.' })
  registroId?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'Attiva non valido.' })
  attiva?: boolean

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(DATA, { message: 'Data di inizio validità non valida.' })
  validaDal?: string
}

export class OverrideMovimentoDto {
  @ApiProperty({ description: 'false = marcatura manuale, true = esclusione manuale.' })
  @IsBoolean({ message: 'Valore non valido.' })
  escluso!: boolean
}

export class MovimentiConsorziQueryDto {
  @ApiProperty({ description: 'Id dei movimenti, separati da virgola (al massimo 200).' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(v => v.length > 0) : value
  )
  @IsArray({ message: 'Movimenti non validi.' })
  @ArrayMaxSize(200, { message: 'Al massimo 200 movimenti per richiesta.' })
  @IsUUID('all', { each: true, message: 'Movimenti non validi.' })
  ids!: string[]
}

export class EstrattoConsorzioQueryDto {
  @ApiProperty({ enum: CONSORZI_AMMESSI })
  @IsIn(CONSORZI_AMMESSI, { message: 'Consorzio non valido.' })
  consorzio!: string

  @ApiProperty({ example: '2026-01-01' })
  @Matches(DATA, { message: 'Periodo non valido.' })
  da!: string

  @ApiProperty({ example: '2026-03-31' })
  @Matches(DATA, { message: 'Periodo non valido.' })
  a!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Sede non valida.' })
  unitaLocaleId?: string
}
