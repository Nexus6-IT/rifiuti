import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * Corpo di `POST rentri/fir/:id/trasporto`: dati del trasporto terrestre. Limiti = contratto RENTRI
 * (`ConducenteModel` 50, targa 10, percorso 250, annotazioni 10000). Nome e cognome del conducente in
 * campi separati: mai spezzati sull'ultimo spazio (ambiguo con i cognomi composti).
 */
export class InviaTrasportoFirRentriDto {
  @ApiProperty({ example: 'Mario', maxLength: 50 })
  @IsString()
  @IsNotEmpty({ message: 'Il nome del conducente è obbligatorio.' })
  @MaxLength(50, { message: 'Il nome del conducente può avere al massimo 50 caratteri.' })
  conducenteNome: string

  @ApiProperty({ example: 'De Rossi', maxLength: 50 })
  @IsString()
  @IsNotEmpty({ message: 'Il cognome del conducente è obbligatorio.' })
  @MaxLength(50, { message: 'Il cognome del conducente può avere al massimo 50 caratteri.' })
  conducenteCognome: string

  @ApiPropertyOptional({
    example: 'AB123CD',
    maxLength: 10,
    description: "Targa dell'automezzo: necessaria se non si indica la targa del rimorchio",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: "La targa dell'automezzo può avere al massimo 10 caratteri." })
  targaAutomezzo?: string

  @ApiPropertyOptional({ example: 'XY987ZW', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'La targa del rimorchio può avere al massimo 10 caratteri.' })
  targaRimorchio?: string

  @ApiPropertyOptional({ maxLength: 250, description: 'Percorso, se diverso dal più breve' })
  @IsOptional()
  @IsString()
  @MaxLength(250, { message: 'Il percorso può avere al massimo 250 caratteri.' })
  percorso?: string

  @ApiPropertyOptional({
    example: '2026-11-21T07:00:00Z',
    description: 'Inizio del trasporto (ISO 8601). Se assente vale la data indicata sul FIR.',
  })
  @IsOptional()
  @IsDateString()
  dataOraInizioTrasporto?: string

  @ApiPropertyOptional({ maxLength: 10000 })
  @IsOptional()
  @IsString()
  @MaxLength(10000, { message: 'Le annotazioni possono avere al massimo 10000 caratteri.' })
  annotazioni?: string

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
