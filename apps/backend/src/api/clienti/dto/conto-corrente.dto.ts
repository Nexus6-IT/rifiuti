/**
 * DTO delle rotte `conti-correnti` (4.1a, D17/D21). Il DTO controlla forma e tipi; le regole sui
 * valori (codice, validita' dell'IBAN e del BIC) sono del dominio e rispondono con l'elenco dei
 * messaggi in italiano, senza mai citare l'IBAN ricevuto.
 *
 * `ModificaContoCorrenteDto` non usa `PartialType` (che accetta anche `null`): un campo o manca,
 * o ha il tipo giusto. Fa eccezione `bic`, dove `null` significa "togli il BIC".
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator'

export class CreaContoCorrenteDto {
  @ApiProperty({ example: 'BPER', description: '1-10 caratteri: lettere, cifre, . - _' })
  @IsString()
  codice: string

  @ApiProperty({ example: 'Conto principale' })
  @IsString()
  descrizione: string

  @ApiProperty({ example: 'Banca di esempio' })
  @IsString()
  banca: string

  @ApiProperty({ example: 'IT60 X054 2811 1010 0000 0123 456', description: 'Anche con spazi' })
  @IsString()
  @MaxLength(42)
  iban: string

  @ApiPropertyOptional({ nullable: true, example: 'BPMOIT22', description: '8 o 11 caratteri' })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  bic?: string | null
}

export class ModificaContoCorrenteDto {
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
  banca?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(42)
  iban?: string

  @ApiPropertyOptional({ nullable: true, description: 'null toglie il BIC' })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  bic?: string | null

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attivo?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
