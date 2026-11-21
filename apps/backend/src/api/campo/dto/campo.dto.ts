import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator'
import { TIPI_EVENTO_CAMPO } from '../../../application/campo/eventi-campo.input'

export class GiroQueryDto {
  @ApiProperty({ example: '2026-11-19' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La data del giro non è valida.' })
  data!: string
}

export class ElencoAutistiQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'Filtro non valido.' })
  attivi?: 'true' | 'false'
}

/** Corpo di `POST /campo/eventi`: la forma la controlla il DTO, i limiti `normalizzaEventoCampo`. */
export class EventoCampoDto {
  @ApiProperty({ description: 'UUID generato dal telefono: chiave di idempotenza' })
  @IsUUID('all', { message: "L'identificativo dell'evento non è valido." })
  id!: string

  @ApiProperty()
  @IsUUID('all', { message: 'Il ritiro non è valido.' })
  ritiroId!: string

  @ApiProperty({ enum: TIPI_EVENTO_CAMPO })
  @IsIn(TIPI_EVENTO_CAMPO, { message: 'Il tipo di evento non è valido.' })
  tipo!: (typeof TIPI_EVENTO_CAMPO)[number]

  @ApiProperty({ description: 'Versione del ritiro che l’autista aveva davanti' })
  @IsInt({ message: 'La versione del ritiro non è valida.' })
  @Min(1, { message: 'La versione del ritiro non è valida.' })
  @Max(2_147_483_647, { message: 'La versione del ritiro non è valida.' })
  versioneVista!: number

  @ApiProperty({ example: '2026-12-01', description: 'Data del giro che l’autista aveva davanti' })
  @IsString({ message: 'La data del ritiro non è valida.' })
  dataVista!: string

  @ApiProperty({ description: 'Sede del produttore che l’autista aveva davanti' })
  @IsUUID('all', { message: 'La sede del ritiro non è valida.' })
  sedeVista!: string

  @ApiProperty({ example: '2026-12-01T08:30:00.000Z', description: 'Orologio del telefono' })
  @IsString({ message: 'La data di rilevazione non è valida.' })
  rilevatoIl!: string

  @ApiPropertyOptional({ description: '`motivo` (non eseguito) oppure `nota` (eseguito)' })
  @IsOptional()
  @IsObject({ message: 'I dati dell’evento non sono validi.' })
  dati?: Record<string, unknown>
}

export class EsitiCampoQueryDto {
  @ApiPropertyOptional({ enum: ['APPLICATO', 'DA_RICONCILIARE'] })
  @IsOptional()
  @IsIn(['APPLICATO', 'DA_RICONCILIARE'], { message: 'Filtro non valido.' })
  esito?: 'APPLICATO' | 'DA_RICONCILIARE'

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Pagina non valida.' })
  @Min(1, { message: 'Pagina non valida.' })
  pagina?: number
}

/** Corpo di `PUT /push/sottoscrizione` e `POST /push/sottoscrizione/annulla`: solo l'endpoint del browser. */
export class PushEndpointDto {
  @ApiProperty({
    example: 'https://fcm.googleapis.com/fcm/send/…',
    description: 'Indirizzo del servizio push del browser (`PushSubscription.endpoint`)',
  })
  @IsString({ message: 'L’indirizzo di notifica non è valido.' })
  @MaxLength(2000, { message: 'L’indirizzo di notifica non è valido.' })
  @Matches(/^https:\/\//, { message: 'L’indirizzo di notifica non è valido.' })
  endpoint!: string
}

/** Corpo di `PUT /push/preferenze`. */
export class PushPreferenzeDto {
  @ApiProperty({ description: 'Avvisami quando il mio giro cambia' })
  @IsBoolean({ message: 'La preferenza non è valida.' })
  giroModificato!: boolean
}
