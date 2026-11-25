import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { TESTO_ANNOTAZIONE_MAX } from '../../../application/rentri/annotazione-rentri.use-case'

/**
 * Corpo di `POST rentri/fir/:id/annotazione` (FIR in viaggio, P4). Il codice fiscale del soggetto NON si
 * riceve: e' sempre quello dell'azienda selezionata (`identificativo_soggetto`).
 */
export class AnnotazioneFirRentriDto {
  @ApiProperty({
    example: 'Il carico è stato pesato due volte.',
    maxLength: TESTO_ANNOTAZIONE_MAX,
    description: "Testo dell'annotazione, da 1 a 10.000 caratteri (limite del contratto RENTRI).",
  })
  @IsString({ message: "Scrivi il testo dell'annotazione." })
  @MinLength(1, { message: "Scrivi il testo dell'annotazione." })
  @MaxLength(TESTO_ANNOTAZIONE_MAX, {
    message: `L'annotazione può avere al massimo ${TESTO_ANNOTAZIONE_MAX} caratteri.`,
  })
  testo: string

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
