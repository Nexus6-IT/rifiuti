import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator'

const DATA = /^\d{4}-\d{2}-\d{2}$/

/** Sede e periodo di una comunicazione a tracciato (CONOU, COBAT): query dell'anteprima e corpo del genera. */
export class PeriodoTracciatoDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Sede non valida.' })
  unitaLocaleId!: string

  @ApiProperty({ example: '2026-05-01' })
  @Matches(DATA, { message: 'Periodo non valido.' })
  da!: string

  @ApiProperty({ example: '2026-05-31' })
  @Matches(DATA, { message: 'Periodo non valido.' })
  a!: string
}

export class ElencoTracciatiQueryDto {
  @ApiProperty({ enum: ['CONOU', 'COBAT'] })
  @IsIn(['CONOU', 'COBAT'], { message: 'Consorzio non valido.' })
  consorzio!: 'CONOU' | 'COBAT'

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Sede non valida.' })
  unitaLocaleId?: string

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @Matches(DATA, { message: 'Periodo non valido.' })
  da?: string

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @Matches(DATA, { message: 'Periodo non valido.' })
  a?: string
}
