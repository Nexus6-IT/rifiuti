import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator'

const DATA = /^\d{4}-\d{2}-\d{2}$/

/** Corpo di `POST` e `PUT /autisti`. Regole di sostanza (CF, riferimenti) nel servizio. */
export class AutistaDto {
  @ApiProperty({ maxLength: 100 })
  @IsString({ message: 'Il nome è obbligatorio.' })
  @MaxLength(100, { message: 'Il nome può avere al massimo 100 caratteri.' })
  nome!: string

  @ApiProperty({ maxLength: 100 })
  @IsString({ message: 'Il cognome è obbligatorio.' })
  @MaxLength(100, { message: 'Il cognome può avere al massimo 100 caratteri.' })
  cognome!: string

  @ApiPropertyOptional({ nullable: true, maxLength: 16 })
  @IsOptional()
  @IsString({ message: 'Codice fiscale non valido.' })
  @MaxLength(40, { message: 'Il codice fiscale deve avere 16 caratteri.' })
  codiceFiscale?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('all', { message: 'Trasportatore non valido.' })
  trasportatoreId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  patenteNumero?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  patenteCategoria?: string | null

  @ApiPropertyOptional({ nullable: true, example: '2030-05-31' })
  @IsOptional()
  @Matches(DATA, { message: 'La scadenza della patente non è una data valida.' })
  patenteScadenza?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(DATA, { message: 'La scadenza della CQC non è una data valida.' })
  cqcScadenza?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(DATA, { message: 'La scadenza dell’ADR non è una data valida.' })
  adrScadenza?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  telefono?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Utente con ruolo autista' })
  @IsOptional()
  @IsUUID('all', { message: 'Utente non valido.' })
  userId?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  attivo?: boolean
}
