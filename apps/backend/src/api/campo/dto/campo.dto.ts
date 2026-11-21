import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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

/**
 * Corpo di `POST /campo/ricevute`: la forma la controlla il DTO, i limiti (nome, ora, struttura del
 * PNG, email) `normalizzaRicevutaCampo`. Il limite di dimensione del JSON e' alzato su questa rotta.
 */
export class RicevutaCampoDto {
  @ApiProperty({ description: 'UUID generato dal telefono: chiave di idempotenza' })
  @IsUUID('all', { message: "L'identificativo della ricevuta non è valido." })
  id!: string

  @ApiProperty()
  @IsUUID('all', { message: 'Il ritiro non è valido.' })
  ritiroId!: string

  @ApiProperty({ example: 'Mario Rossi', description: 'Nome di chi firma' })
  @IsString({ message: 'Il nome di chi firma non è valido.' })
  firmatarioNome!: string

  @ApiProperty({ example: '2026-12-01T08:30:00.000Z', description: 'Orologio del telefono' })
  @IsString({ message: "L'ora della firma non è valida." })
  firmatoIl!: string

  @ApiProperty({ description: 'Immagine del tratto: PNG in base64, al massimo 128 KiB' })
  @IsString({ message: 'La firma non è valida.' })
  firmaPng!: string

  @ApiPropertyOptional({
    description: 'Invio al cliente (facoltativo, ignorato se l’invio è spento)',
  })
  @IsOptional()
  @IsString({ message: "L'indirizzo email del cliente non è valido." })
  emailCliente?: string
}

export class RicevuteCampoQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Ritiro non valido.' })
  ritiroId?: string

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Pagina non valida.' })
  @Min(1, { message: 'Pagina non valida.' })
  pagina?: number
}
