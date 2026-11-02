/**
 * DTO delle rotte `codici-iva` (4.2a, D3/R12/R24). Il DTO controlla forma e tipi; le regole sui
 * valori (codice, aliquota 0-100, natura) sono del dominio e rispondono con l'elenco dei messaggi
 * in italiano. L'aliquota e' una stringa (mai `@IsNumber`: un double non rappresenta 0,1) e il
 * frontend sostituisce la virgola col punto prima di inviarla.
 *
 * `ModificaCodiceIvaDto` non usa `PartialType`: un campo o manca, o ha il tipo giusto. L'unico
 * `null` ammesso e' quello della natura (la toglie).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator'

export class CreaCodiceIvaDto {
  @ApiProperty({ example: '22', description: 'Da 1 a 3 lettere o cifre' })
  @IsString()
  codice: string

  @ApiProperty({ example: 'IVA ordinaria 22%' })
  @IsString()
  descrizione: string

  @ApiProperty({ example: '22.00', description: 'Stringa decimale da 0 a 100, max due decimali' })
  @IsString()
  aliquota: string

  @ApiPropertyOptional({ example: 'N6.1', description: 'Obbligatoria con aliquota zero' })
  @IsOptional()
  @IsString()
  natura?: string | null

  @ApiPropertyOptional({ description: 'Omesso = true' })
  @IsOptional()
  @IsBoolean()
  attivo?: boolean
}

export class ModificaCodiceIvaDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  codice?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  descrizione?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  aliquota?: string

  @ApiPropertyOptional({ description: 'null = toglie la natura' })
  @IsOptional()
  @IsString()
  natura?: string | null

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attivo?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
