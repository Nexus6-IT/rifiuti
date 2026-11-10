/**
 * DTO delle rotte `modelli-stampa` (4.7, T6). Il DTO controlla forma e tipi; le regole sui valori
 * (lunghezze, colori, copie, logo) sono del dominio e rispondono con l'elenco dei messaggi in
 * italiano. Il logo e' base64 puro (senza `data:`): il tetto di lunghezza copre 256 KiB di byte
 * piu' un eventuale prefisso data URL accettato per tolleranza.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator'
import { AMBITI_MODELLO } from '../../../domain/modelli-stampa/modello'

/** 256 KiB in base64 sono 349.528 caratteri; margine per il prefisso data URL. */
export const LOGO_BASE64_LUNGHEZZA_MASSIMA = 349_700

export class CreaModelloStampaDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  nome: string

  @ApiPropertyOptional({ enum: AMBITI_MODELLO, description: 'Omesso = GENERALE' })
  @IsOptional()
  @IsIn(AMBITI_MODELLO)
  ambito?: (typeof AMBITI_MODELLO)[number]

  @ApiPropertyOptional({ minimum: 1, maximum: 4, description: 'Omesso = 1' })
  @IsOptional()
  @IsInt({ message: 'Le copie devono essere un intero fra 1 e 4.' })
  copie?: number

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  testoIntestazione?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  testoPiePagina?: string | null

  @ApiPropertyOptional({ example: '#3b82f6' })
  @IsOptional()
  @IsString()
  colorePrimario?: string

  @ApiPropertyOptional({ example: '#1e40af' })
  @IsOptional()
  @IsString()
  coloreSecondario?: string

  @ApiPropertyOptional({ nullable: true, description: 'PNG o JPEG in base64 puro, max 256 KiB' })
  @IsOptional()
  @IsString()
  @MaxLength(LOGO_BASE64_LUNGHEZZA_MASSIMA, { message: 'Il logo supera i 256 KiB.' })
  logoBase64?: string | null
}

/** PUT: sostituisce tutti i campi del modello (i nullable possono essere `null`) e porta la versione. */
export class ModificaModelloStampaDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  nome: string

  @ApiProperty({ enum: AMBITI_MODELLO })
  @IsIn(AMBITI_MODELLO)
  ambito: (typeof AMBITI_MODELLO)[number]

  @ApiProperty({ minimum: 1, maximum: 4 })
  @IsInt({ message: 'Le copie devono essere un intero fra 1 e 4.' })
  copie: number

  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  testoIntestazione: string | null

  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  testoPiePagina: string | null

  @ApiProperty()
  @IsString()
  colorePrimario: string

  @ApiProperty()
  @IsString()
  coloreSecondario: string

  @ApiProperty({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(LOGO_BASE64_LUNGHEZZA_MASSIMA, { message: 'Il logo supera i 256 KiB.' })
  logoBase64: string | null

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  versione: number
}

export class RendiPredefinitoDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  versione: number
}
