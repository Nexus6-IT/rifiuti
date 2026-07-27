import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * Corpo di `POST /rentri/fir/:id/allegati` (R3 Task 6), tradotto verso
 * `DatiAllegatoModel` (`docs/contracts/rentri/formulari.yaml`, righe
 * 6902-6938) da {@link RENTRIApiClient.caricaAllegato}.
 *
 * `contenutoBase64` porta il vincolo di lunghezza dello SCHEMA del contratto
 * (`maxLength: 1048576` caratteri sulla stringa base64) — un vincolo
 * SINTATTICO, diverso dal vincolo di BUSINESS verificato da
 * `GestisciAllegatiFIRUseCase` (1 MB di byte DECODIFICATI, v.
 * `RENTRIApiClient.LIMITE_ALLEGATO_BYTES`): una stringa base64 di 1.048.576
 * caratteri decodifica a ~768 KB, quindi il vincolo qui è meno stringente e
 * NON sostituisce quello di business.
 *
 * NON porta `identificativo_soggetto` (CF del soggetto a cui riferire
 * l'allegato, richiesto dal contratto): lo use case lo risolve dal codice
 * fiscale del TENANT — stessa fonte usata da `GetAzioniDisponibiliUseCase`
 * per il proprio `identificativo_soggetto` di query — non un valore
 * arbitrario passato dal chiamante.
 */
export class CaricaAllegatoFirRentriDto {
  @ApiProperty({ description: 'Nome del file', maxLength: 255 })
  @IsString()
  @IsNotEmpty({ message: 'nomeFile è obbligatorio' })
  @MaxLength(255, { message: 'nomeFile non può superare 255 caratteri' })
  nomeFile: string

  @ApiProperty({
    enum: ['application/pdf'],
    description: "Tipo di documento — l'ente accetta solo 'application/pdf'.",
  })
  @IsIn(['application/pdf'], { message: "contentType deve essere 'application/pdf'" })
  contentType: string

  @ApiProperty({
    description: 'Contenuto del file, codificato base64.',
    maxLength: 1048576,
  })
  @IsString()
  @IsNotEmpty({ message: 'contenutoBase64 è obbligatorio' })
  @MaxLength(1048576, { message: 'contenutoBase64 supera il limite sintattico del contratto' })
  contenutoBase64: string

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
