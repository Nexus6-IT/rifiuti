/**
 * DTO delle rotte `spese-accessorie` (4.1a, D17/D23). L'importo e' una stringa decimale col punto
 * (`^\d{1,8}(\.\d{1,2})?$`), mai un numero: il frontend manda il punto, niente virgola (R2).
 * `ModificaSpesaAccessoriaDto` non usa `PartialType` (che accetta anche `null`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsString, Matches, Min, ValidateIf } from 'class-validator'

export const TIPI_SPESA = ['INCASSO', 'BOLLO'] as const
export const IMPORTO_REGEX = /^\d{1,8}(\.\d{1,2})?$/
const MESSAGGIO_IMPORTO =
  "L'importo deve essere un numero non negativo con al massimo due decimali."

export class CreaSpesaAccessoriaDto {
  @ApiProperty({ enum: TIPI_SPESA })
  @IsIn(TIPI_SPESA)
  tipo: (typeof TIPI_SPESA)[number]

  @ApiProperty({ example: 'INC', description: '1-10 caratteri: lettere, cifre, . - _' })
  @IsString()
  codice: string

  @ApiProperty({ example: 'Spese di incasso' })
  @IsString()
  descrizione: string

  @ApiProperty({ example: '2.50', description: 'Stringa decimale col punto, max 2 decimali' })
  @IsString()
  @Matches(IMPORTO_REGEX, { message: MESSAGGIO_IMPORTO })
  importo: string
}

export class ModificaSpesaAccessoriaDto {
  @ApiPropertyOptional({ enum: TIPI_SPESA })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(TIPI_SPESA)
  tipo?: (typeof TIPI_SPESA)[number]

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  codice?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  descrizione?: string

  @ApiPropertyOptional({ example: '2.50' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(IMPORTO_REGEX, { message: MESSAGGIO_IMPORTO })
  importo?: string

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attiva?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
