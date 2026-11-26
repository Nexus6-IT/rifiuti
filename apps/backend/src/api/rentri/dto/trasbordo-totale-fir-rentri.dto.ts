import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * Corpo di `POST rentri/fir/:id/trasbordo-totale` (FIR in viaggio, P6). Il soggetto che invia NON si riceve:
 * e' sempre l'azienda selezionata, che deve essere un trasportatore del FIR. Il NUOVO trasportatore si indica
 * con l'id dell'anagrafica (snapshot letto dal backend), non con dati liberi. La data di inizio si controlla in
 * modo stretto nello use case (ISO 8601 con fuso) e parte all'ente sempre in UTC; gli altri limiti sono quelli
 * del contratto RENTRI (`DatiTrasportoTerrestreModel`).
 */
export class TrasbordoTotaleFirRentriDto {
  @ApiProperty({ description: 'Id del NUOVO trasportatore nell’anagrafica dell’azienda.' })
  @IsUUID('all', { message: 'Indica il nuovo trasportatore.' })
  trasportatoreId: string

  @ApiProperty({ example: 'Luca', maxLength: 50 })
  @IsString({ message: 'Indica il nome del conducente.' })
  @IsNotEmpty({ message: 'Indica il nome del conducente.' })
  @MaxLength(50, { message: 'Il nome del conducente può avere al massimo 50 caratteri.' })
  conducenteNome: string

  @ApiProperty({ example: 'Bianchi', maxLength: 50 })
  @IsString({ message: 'Indica il cognome del conducente.' })
  @IsNotEmpty({ message: 'Indica il cognome del conducente.' })
  @MaxLength(50, { message: 'Il cognome del conducente può avere al massimo 50 caratteri.' })
  conducenteCognome: string

  @ApiPropertyOptional({
    maxLength: 10,
    description: 'Serve la targa dell’automezzo o quella del rimorchio.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'La targa dell’automezzo può avere al massimo 10 caratteri.' })
  targaAutomezzo?: string

  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'La targa del rimorchio può avere al massimo 10 caratteri.' })
  targaRimorchio?: string

  @ApiPropertyOptional({ maxLength: 250, description: 'Percorso, se diverso dal più breve.' })
  @IsOptional()
  @IsString()
  @MaxLength(250, { message: 'Il percorso può avere al massimo 250 caratteri.' })
  percorso?: string

  @ApiProperty({
    example: '2026-11-18T12:00:00Z',
    description:
      'Data e ora di inizio del trasporto del nuovo trasportatore, ISO 8601 con fuso orario.',
  })
  @IsString({ message: 'Indica data e ora di inizio del trasporto.' })
  dataOraInizioTrasporto: string

  @ApiPropertyOptional({
    description: 'Il nuovo trasportatore prende in carico anche il rimorchio precedente.',
  })
  @IsOptional()
  @IsBoolean()
  presaInCaricoRimorchioPrecedente?: boolean

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
