/**
 * DTO delle variazioni di prezzo (4.2a, D20/D21, R12/R24), condivisi fra l'archivio (Task 10) e
 * i contratti (Task 24). Il DTO controlla forma e tipi; le regole sui valori (numero valido,
 * maggiore di zero, decimali) sono del dominio e rispondono con messaggi in italiano. Il valore e'
 * una STRINGA decimale (mai `@IsNumber`: un double non rappresenta 0,1).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export const TIPI_VARIAZIONE = [
  'AUMENTO_PERCENTUALE',
  'AUMENTO_IMPORTO',
  'DIMINUZIONE_PERCENTUALE',
  'DIMINUZIONE_IMPORTO',
  'SOSTITUZIONE_IVA',
] as const

/** Massimo di elementi in un filtro per elenco: oltre non e' un filtro, e' un abuso. */
export const MAX_ELEMENTI_FILTRO = 10_000

/** Parte comune ai corpi di variazione: tipo, valore, codici IVA. */
export class CorpoVariazioneBaseDto {
  @ApiProperty({ enum: TIPI_VARIAZIONE })
  @IsIn(TIPI_VARIAZIONE, { message: 'Il tipo di variazione non è ammesso.' })
  tipo: (typeof TIPI_VARIAZIONE)[number]

  @ApiPropertyOptional({ example: '10', description: 'Stringa decimale (virgola o punto)' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  valore?: string

  @ApiPropertyOptional({ description: 'Sostituzione IVA: codice IVA da sostituire' })
  @IsOptional()
  @IsUUID()
  daCodiceIvaId?: string

  @ApiPropertyOptional({ description: 'Sostituzione IVA: codice IVA nuovo' })
  @IsOptional()
  @IsUUID()
  aCodiceIvaId?: string
}

export class FiltroVariazioneArchivioDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTI_FILTRO)
  @IsUUID('all', { each: true })
  addebitiIds?: string[]

  @ApiPropertyOptional({ type: [String], description: 'Categorie di addebito (anche piu di una)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTI_FILTRO)
  @IsUUID('all', { each: true })
  categorieIds?: string[]

  @ApiPropertyOptional({ type: [String], example: ['V', 'F'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(4, { each: true })
  tipi?: string[]

  @ApiPropertyOptional({ type: [Number], description: 'Listini 1-6; assente = tutti' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(6, { each: true })
  listini?: number[]
}

export class CorpoVariazioneArchivioDto extends CorpoVariazioneBaseDto {
  @ApiProperty({ type: FiltroVariazioneArchivioDto })
  @IsObject()
  @ValidateNested()
  @Type(() => FiltroVariazioneArchivioDto)
  filtri: FiltroVariazioneArchivioDto
}

export class ApplicaVariazioneArchivioDto extends CorpoVariazioneArchivioDto {
  @ApiProperty({ description: "Impronta restituita dall'anteprima (SHA-256 esadecimale)" })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: "L'impronta dell'anteprima non è valida: rifai l'anteprima.",
  })
  impronta: string
}
