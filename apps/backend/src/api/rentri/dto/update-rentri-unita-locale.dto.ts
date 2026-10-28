import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
  Matches,
} from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'

const senzaSpazi = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

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

  // Anagrafica della sede per la sua dichiarazione MUD (F2-8). `null` o stringa vuota cancella il dato.

  @ApiPropertyOptional({ example: 'Via Roma', description: 'Indirizzo della sede', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  indirizzo?: string | null

  @ApiPropertyOptional({ example: '12/A', description: 'Numero civico', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  civico?: string | null

  @ApiPropertyOptional({
    example: '20121',
    description: 'CAP, 5 cifre (stringa vuota = cancella)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  @Transform(senzaSpazi)
  @Matches(/^([0-9]{5})?$/, { message: 'Il CAP deve essere di 5 cifre' })
  cap?: string | null

  @ApiPropertyOptional({ example: 'Milano', description: 'Comune della sede', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  comune?: string | null

  @ApiPropertyOptional({
    example: 'MI',
    description: 'Sigla della provincia, 2 lettere (stringa vuota = cancella)',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  @Transform(senzaSpazi)
  @Matches(/^([A-Za-z]{2})?$/, { message: 'La provincia deve essere la sigla di 2 lettere' })
  provincia?: string | null

  @ApiPropertyOptional({
    example: 12,
    description: 'Numero di addetti della sede (intero >= 0)',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  numeroAddetti?: number | null
}
