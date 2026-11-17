import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator'
import { ATTIVITA_ORR, type AttivitaOrr } from '../../../domain/comunicazioni/orr/costanti'

const GIORNO = /^\d{4}-\d{2}-\d{2}$/

/** Parametri comuni di anteprima (query) e generazione (body). Mesi interi e stesso anno: li controlla il servizio. */
export class RichiestaOrrDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Sede non valida.' })
  unitaLocaleId!: string

  @ApiProperty({ example: '2026-01-01', description: 'Primo giorno del primo mese' })
  @Matches(GIORNO, { message: 'Data di inizio non valida (AAAA-MM-GG).' })
  da!: string

  @ApiProperty({ example: '2026-03-31', description: 'Ultimo giorno del mese finale' })
  @Matches(GIORNO, { message: 'Data di fine non valida (AAAA-MM-GG).' })
  a!: string

  @ApiPropertyOptional({ enum: ATTIVITA_ORR })
  @IsOptional()
  @IsIn([...ATTIVITA_ORR], { message: 'Attività non valida.' })
  attivita?: AttivitaOrr
}

export class ElencoOrrQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Sede non valida.' })
  unitaLocaleId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(GIORNO, { message: 'Data di inizio non valida (AAAA-MM-GG).' })
  da?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(GIORNO, { message: 'Data di fine non valida (AAAA-MM-GG).' })
  a?: string
}
