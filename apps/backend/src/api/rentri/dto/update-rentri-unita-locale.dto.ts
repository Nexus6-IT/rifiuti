import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, Min, MaxLength } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

/**
 * DTO per aggiornare un'unità locale RENTRI esistente. Il numIscrSito NON è
 * modificabile qui: è l'identificativo con cui RENTRI conosce la sede: per
 * cambiarlo va creata una nuova unità locale.
 */
export class UpdateRentriUnitaLocaleDto {
  @ApiPropertyOptional({
    example: 'Sede di Milano',
    description: 'Denominazione leggibile della sede',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  denominazione?: string

  @ApiPropertyOptional({
    description:
      'Stato di attività della sede. false = sede cessata: i formulari già agganciati restano validi, la sede esce dalle scelte per nuovi agganci.',
  })
  @IsOptional()
  @IsBoolean()
  attiva?: boolean

  @ApiPropertyOptional({
    description:
      'Soglia di scorta di numeri FIR vidimati da mantenere sempre pronti per questa sede (R6). ' +
      'Omesso o null = nessuna soglia: il job periodico non vidima nulla per questa sede.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  dimensioneScortaDesiderata?: number | null
}
