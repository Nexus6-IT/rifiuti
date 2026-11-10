import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'

const ANNO_MIN = 2000
const ANNO_MAX = 2100

export class AnteprimaOrsoQueryDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Sede non valida.' })
  unitaLocaleId!: string

  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt({ message: 'Anno non valido.' })
  @Min(ANNO_MIN, { message: 'Anno non valido.' })
  @Max(ANNO_MAX, { message: 'Anno non valido.' })
  anno!: number
}

export class GeneraOrsoDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Sede non valida.' })
  unitaLocaleId!: string

  @ApiProperty({ example: 2026 })
  @IsInt({ message: 'Anno non valido.' })
  @Min(ANNO_MIN, { message: 'Anno non valido.' })
  @Max(ANNO_MAX, { message: 'Anno non valido.' })
  anno!: number
}

export class ElencoComunicazioniQueryDto {
  @ApiPropertyOptional({ enum: ['ORSO'] })
  @IsOptional()
  @IsIn(['ORSO'], { message: 'Consorzio non valido.' })
  consorzio?: 'ORSO'

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Sede non valida.' })
  unitaLocaleId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Anno non valido.' })
  @Min(ANNO_MIN, { message: 'Anno non valido.' })
  @Max(ANNO_MAX, { message: 'Anno non valido.' })
  anno?: number
}
