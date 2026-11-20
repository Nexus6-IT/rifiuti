import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { LUOGO_SOSTA_MAX } from '../../../application/rentri/sosta-tecnica-rentri.use-case'

/**
 * Corpo di `POST rentri/fir/:id/sosta-tecnica` (FIR in viaggio, P5). Il soggetto NON si riceve: la sosta e'
 * sempre dell'azienda selezionata, che deve essere un trasportatore del FIR. Le date si controllano in modo
 * stretto nello use case (ISO 8601 con fuso, sospensione < ripresa) e partono all'ente sempre in UTC.
 */
export class SostaTecnicaFirRentriDto {
  @ApiProperty({
    example: 'Area di servizio A1 km 120',
    maxLength: LUOGO_SOSTA_MAX,
    description: 'Luogo di stazionamento, da 1 a 1000 caratteri (limite del contratto RENTRI).',
  })
  @IsString({ message: 'Indica il luogo della sosta.' })
  @IsNotEmpty({ message: 'Indica il luogo della sosta.' })
  @MaxLength(LUOGO_SOSTA_MAX, {
    message: `Il luogo può avere al massimo ${LUOGO_SOSTA_MAX} caratteri.`,
  })
  luogoStazionamento: string

  @ApiProperty({
    example: '2026-11-18T10:00:00Z',
    description: 'Data e ora di sospensione, ISO 8601 con fuso orario (inviata all’ente in UTC).',
  })
  @IsString({ message: 'Indica data e ora di sospensione.' })
  dataOraSospensione: string

  @ApiProperty({
    example: '2026-11-18T12:30:00Z',
    description: 'Data e ora di ripresa, ISO 8601 con fuso orario; deve seguire la sospensione.',
  })
  @IsString({ message: 'Indica data e ora di ripresa.' })
  dataOraRipresa: string

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
