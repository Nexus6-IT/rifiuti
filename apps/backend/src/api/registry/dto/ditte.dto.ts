/**
 * DTO delle rotte `registry/ditte` (F2-10, D7). Il documento Swagger e' in italiano.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator'

const MESSAGGIO_CF_LUNGO =
  'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite'

const CAMPI_INDIRIZZO = ['via', 'civico', 'cap', 'citta', 'provincia'] as const

/** Nell'aggiornamento l'indirizzo e' tutto-o-niente: se ne arriva un campo servono tutti. */
const seIndirizzoPresente = (o: Record<string, unknown>) =>
  CAMPI_INDIRIZZO.some(c => o[c] !== undefined)

export class CercaDittaDto {
  @ApiProperty({
    description:
      'Partita IVA o codice fiscale da cercare. Si usa POST perche in query string finirebbe nei log.',
    example: '12345678903',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  identificativo: string
}

export class AggiornaDittaDto {
  @ApiPropertyOptional({ description: 'Nuova ragione sociale (condivisa da tutti i ruoli)' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  ragioneSociale?: string

  @ApiPropertyOptional({
    description:
      'Partita IVA: si aggiunge se manca; si sostituisce solo se quella attuale non passa il controllo e la nuova si',
    example: '12345678903',
  })
  @IsString()
  @IsOptional()
  @MaxLength(16)
  partitaIva?: string

  @ApiPropertyOptional({
    description: 'Codice fiscale: si aggiunge se manca, non si cambia (al massimo 16 caratteri)',
    maxLength: 16,
  })
  @IsString()
  @IsOptional()
  @MaxLength(16, { message: MESSAGGIO_CF_LUNGO })
  codiceFiscale?: string
}

class ContattiSedeDto {
  @ApiPropertyOptional({ description: 'Denominazione della sede (es. "Stabilimento di Latina")' })
  @IsString()
  @IsOptional()
  denominazione?: string

  @ApiPropertyOptional({ description: 'Referente della sede' })
  @IsString()
  @IsOptional()
  referente?: string

  @ApiPropertyOptional({ description: 'Email della sede' })
  @IsEmail()
  @IsOptional()
  email?: string

  @ApiPropertyOptional({ description: 'Telefono della sede' })
  @IsString()
  @IsOptional()
  telefono?: string

  @ApiPropertyOptional({ description: 'PEC della sede' })
  @IsString()
  @IsOptional()
  pec?: string
}

export class CreaSedeDto extends ContattiSedeDto {
  @ApiProperty({ example: 'Via Roma' })
  @IsString()
  @IsNotEmpty()
  via: string

  @ApiProperty({ example: '1' })
  @IsString()
  @IsNotEmpty()
  civico: string

  @ApiProperty({ example: '00100', description: 'CAP di 5 cifre' })
  @IsString()
  @IsNotEmpty()
  cap: string

  @ApiProperty({ example: 'Roma' })
  @IsString()
  @IsNotEmpty()
  citta: string

  @ApiProperty({ example: 'RM' })
  @IsString()
  @IsNotEmpty()
  provincia: string
}

export class AggiornaSedeDto extends ContattiSedeDto {
  @ApiPropertyOptional({ description: 'Indirizzo: se ne indichi un campo servono tutti e cinque' })
  @ValidateIf(seIndirizzoPresente)
  @IsString()
  @IsNotEmpty()
  via?: string

  @ApiPropertyOptional()
  @ValidateIf(seIndirizzoPresente)
  @IsString()
  @IsNotEmpty()
  civico?: string

  @ApiPropertyOptional()
  @ValidateIf(seIndirizzoPresente)
  @IsString()
  @IsNotEmpty()
  cap?: string

  @ApiPropertyOptional()
  @ValidateIf(seIndirizzoPresente)
  @IsString()
  @IsNotEmpty()
  citta?: string

  @ApiPropertyOptional()
  @ValidateIf(seIndirizzoPresente)
  @IsString()
  @IsNotEmpty()
  provincia?: string

  @ApiPropertyOptional({
    description:
      'false disattiva la sede (rifiutato per la principale e per la predefinita di un ruolo), true la riattiva',
  })
  @IsBoolean()
  @IsOptional()
  attiva?: boolean
}
