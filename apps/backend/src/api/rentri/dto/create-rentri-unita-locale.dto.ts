import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength, Matches } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { NUM_ISCR_SITO_PATTERN } from '../../../infrastructure/rentri/rentri-credential.service'

/**
 * DTO per creare una nuova unità locale RENTRI del tenant corrente.
 * `principale` è una richiesta: viene forzata a true per la primissima sede
 * del tenant (chi ha una sola sede non deve scegliere nulla).
 */
export class CreateRentriUnitaLocaleDto {
  @ApiProperty({
    example: 'OP1234ABC123456-RM1234',
    description: "Numero di iscrizione dell'unità locale RENTRI (num_iscr_sito)",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(NUM_ISCR_SITO_PATTERN, {
    message:
      "numIscrSito non valido: formato atteso dell'unità locale RENTRI (es. OP1234ABC123456-RM1234)",
  })
  numIscrSito: string

  @ApiProperty({ example: 'Sede di Milano', description: 'Denominazione leggibile della sede' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  denominazione: string

  @ApiPropertyOptional({
    description:
      'Rendila la sede principale del tenant. Ignorato (forzato a true) per la primissima sede.',
  })
  @IsOptional()
  @IsBoolean()
  principale?: boolean
}
