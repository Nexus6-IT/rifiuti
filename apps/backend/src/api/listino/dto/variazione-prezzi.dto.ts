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
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { TIPI_VARIAZIONE, type TipoVariazione } from '../../../domain/listino/variazione-prezzi'

/** Massimo di elementi in un filtro per elenco: oltre non e' un filtro, e' un abuso. */
export const MAX_ELEMENTI_FILTRO = 10_000

/** Parte comune ai corpi di variazione: tipo, valore, codici IVA. */
export class CorpoVariazioneBaseDto {
  @ApiProperty({ enum: TIPI_VARIAZIONE })
  @IsIn([...TIPI_VARIAZIONE], { message: 'Il tipo di variazione non è ammesso.' })
  tipo: TipoVariazione

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

// --- Variazione dei prezzi dei contratti (Task 24, D20, R46) e adeguamento ISTAT (D22) ----------

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
const MSG_DATA = 'La data deve essere nel formato AAAA-MM-GG.'

export class FiltroVariazioneContrattiDto {
  @ApiPropertyOptional({ description: 'Addebito dell’archivio della riga' })
  @IsOptional()
  @IsUUID()
  addebitoId?: string

  @ApiPropertyOptional({ example: '20 03 01' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cerCode?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  riferimento?: string

  @ApiPropertyOptional({
    example: '10,00',
    description: 'Stringa decimale, confrontata per valore',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  prezzoAttuale?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  anchePrezziZero?: boolean

  @ApiPropertyOptional({ enum: ['NORMALE', 'SPECIALE'], isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['NORMALE', 'SPECIALE'], { each: true, message: 'Il tipo di prezzo non è ammesso.' })
  tipiPrezzo?: ('NORMALE' | 'SPECIALE')[]

  @ApiPropertyOptional({ type: [String], example: ['V', 'F', 'CER'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(4, { each: true })
  tipi?: string[]

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTI_FILTRO)
  @IsUUID('all', { each: true })
  categorieAddebitoIds?: string[]

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTI_FILTRO)
  @IsUUID('all', { each: true })
  centriRicavoIds?: string[]

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTI_FILTRO)
  @IsUUID('all', { each: true })
  tipiContrattoIds?: string[]

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTI_FILTRO)
  @IsUUID('all', { each: true })
  categorieContrattoIds?: string[]

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(DATA_ISO, { message: MSG_DATA })
  inizioDal?: string

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATA_ISO, { message: MSG_DATA })
  inizioAl?: string

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(DATA_ISO, { message: MSG_DATA })
  fineDal?: string

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATA_ISO, { message: MSG_DATA })
  fineAl?: string

  @ApiPropertyOptional({ type: [String], description: 'Contratti scelti' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTI_FILTRO)
  @IsUUID('all', { each: true })
  contrattiIds?: string[]

  @ApiPropertyOptional({ type: [String], description: 'Addebiti dell’archivio scelti' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ELEMENTI_FILTRO)
  @IsUUID('all', { each: true })
  addebitiIds?: string[]

  @ApiPropertyOptional({
    example: '2026-03-31',
    description: 'Fissi con la prima scadenza in questo giorno',
  })
  @IsOptional()
  @Matches(DATA_ISO, { message: MSG_DATA })
  primaScadenzaFissi?: string
}

export class CorpoVariazioneContrattiDto extends CorpoVariazioneBaseDto {
  @ApiPropertyOptional({ description: 'Varia solo il minimo fatturabile, non il prezzo' })
  @IsOptional()
  @IsBoolean()
  soloMinimi?: boolean

  @ApiProperty({ type: FiltroVariazioneContrattiDto })
  @IsObject()
  @ValidateNested()
  @Type(() => FiltroVariazioneContrattiDto)
  filtri: FiltroVariazioneContrattiDto
}

export class ApplicaVariazioneContrattiDto extends CorpoVariazioneContrattiDto {
  @ApiProperty({ description: "Impronta restituita dall'anteprima (SHA-256 esadecimale)" })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: "L'impronta dell'anteprima non è valida: rifai l'anteprima.",
  })
  impronta: string
}

export class MesiIstatQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'ancheAnnoPrecedente deve essere true o false.' })
  ancheAnnoPrecedente?: string
}

export class PercentualeIstatDto {
  @ApiProperty({ example: 2024 })
  @IsInt()
  anno: number

  @ApiProperty({ example: 3 })
  @IsInt()
  mese: number

  @ApiProperty({
    example: '2.5',
    description: 'Stringa decimale col punto, maggiore di 0 e minore di 100',
  })
  @IsString()
  @MaxLength(30)
  percentuale: string
}

export class CorpoIstatDto {
  @ApiProperty({ type: [PercentualeIstatDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Indica almeno una percentuale.' })
  @ArrayMaxSize(600)
  @ValidateNested({ each: true })
  @Type(() => PercentualeIstatDto)
  percentuali: PercentualeIstatDto[]

  @ApiProperty({ type: [String], example: ['V', 'F'] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(4, { each: true })
  tipi: string[]
}

export class ApplicaIstatDto extends CorpoIstatDto {
  @ApiProperty({ description: "Impronta restituita dall'anteprima (SHA-256 esadecimale)" })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: "L'impronta dell'anteprima non è valida: rifai l'anteprima.",
  })
  impronta: string
}
