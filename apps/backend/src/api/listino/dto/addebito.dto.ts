/**
 * DTO delle rotte `addebiti` (4.2a, D6/R12/R24). Il DTO controlla forma e tipi; le regole sui
 * valori (codice, unita di misura, tipo, cascate, prezzi) sono del dominio e rispondono con
 * l'elenco dei messaggi in italiano. Prezzi, sconti e provvigioni sono stringhe (mai `@IsNumber`:
 * un double non rappresenta 0,1); il frontend sostituisce la virgola col punto.
 *
 * Alla creazione `codice` (null o assente = primo libero), `attivo` e `listini` sono facoltativi.
 * `ModificaAddebitoDto` non usa `PartialType`: un campo o manca, o ha il tipo giusto; `null` e'
 * ammesso solo dove azzera davvero (riferimenti e testi facoltativi). `listini` sostituisce tutti
 * e sei i listini.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

export class PrezzoListinoDto {
  @ApiProperty({ minimum: 1, maximum: 6 })
  @IsInt()
  numero: number

  @ApiPropertyOptional({ nullable: true, example: '10.50', description: 'Stringa decimale' })
  @IsOptional()
  @IsString()
  prezzo?: string | null

  @ApiPropertyOptional({ nullable: true, example: '10+5', description: 'Cascata di percentuali' })
  @IsOptional()
  @IsString()
  sconto?: string | null

  @ApiPropertyOptional({ nullable: true, example: '3', description: 'Cascata di percentuali' })
  @IsOptional()
  @IsString()
  provvigione?: string | null
}

export class CreaAddebitoDto {
  @ApiPropertyOptional({
    nullable: true,
    example: '12',
    description: 'Da 1 a 5 cifre; null o assente = primo codice libero',
  })
  @IsOptional()
  @IsString()
  codice?: string | null

  @ApiProperty({ example: 'Trasporto' })
  @IsString()
  descrizione: string

  @ApiProperty({ description: 'Codifica di genere GRUPPO' })
  @IsString()
  gruppoId: string

  @ApiProperty({ example: 'KG' })
  @IsString()
  unitaMisura: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  codiceIvaId?: string | null

  @ApiPropertyOptional({ example: 'V', description: 'Omesso = V' })
  @IsOptional()
  @IsString()
  tipo?: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  categoriaId?: string | null

  @ApiPropertyOptional({ enum: ['SCONTATO', 'LORDO'], description: 'Omesso = SCONTATO' })
  @IsOptional()
  @IsString()
  tipoProvvigione?: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  centroRicavoId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  categoriaStatistica1Id?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  categoriaStatistica2Id?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 45 })
  @IsOptional()
  @IsString()
  notaUsoInterno?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  appunti?: string | null

  @ApiPropertyOptional({ type: [PrezzoListinoDto], description: 'I mancanti sono vuoti' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrezzoListinoDto)
  listini?: PrezzoListinoDto[]

  @ApiPropertyOptional({ description: 'Omesso = true' })
  @IsOptional()
  @IsBoolean()
  attivo?: boolean
}

export class ModificaAddebitoDto {
  @ApiPropertyOptional({ description: 'Da 1 a 5 cifre' })
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
  gruppoId?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  unitaMisura?: string

  @ApiPropertyOptional({ nullable: true, description: 'null = toglie il codice IVA' })
  @IsOptional()
  @IsString()
  codiceIvaId?: string | null

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  tipo?: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  categoriaId?: string | null

  @ApiPropertyOptional({ enum: ['SCONTATO', 'LORDO'] })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  tipoProvvigione?: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  centroRicavoId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  categoriaStatistica1Id?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  categoriaStatistica2Id?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 45 })
  @IsOptional()
  @IsString()
  notaUsoInterno?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  appunti?: string | null

  @ApiPropertyOptional({
    type: [PrezzoListinoDto],
    description: 'Sostituisce tutti e sei i listini',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrezzoListinoDto)
  listini?: PrezzoListinoDto[]

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attivo?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}

export class ElencoAddebitiQueryDto {
  @ApiPropertyOptional({ description: 'Codice o descrizione' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  testo?: string

  @ApiPropertyOptional({ example: 'V' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  tipo?: string

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  soloAttivi?: string

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  dimensione?: number
}
