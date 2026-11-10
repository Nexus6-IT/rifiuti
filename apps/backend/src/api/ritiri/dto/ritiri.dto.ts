import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

const FASCE = ['MATTINA', 'POMERIGGIO'] as const
const STATI_VISIBILI = [
  'DA_GENERARE',
  'FIR_BOZZA',
  'FIR_EMESSO',
  'IN_TRASPORTO',
  'CONSEGNATO',
  'NON_ESEGUITO',
  'ANNULLATO',
] as const
const PROVENIENZE = ['URBANO', 'SPECIALE'] as const
const TIPI_TRATTA = ['TERRESTRE', 'FERROVIARIA', 'MARITTIMA'] as const
const DATA = /^\d{4}-\d{2}-\d{2}$/

/** Campi comuni a creazione e modifica. La sostanza (importi, CER, anagrafiche) la valida il servizio. */
export class DatiRitiroDto {
  @ApiProperty({ example: '2026-11-12' })
  @Matches(DATA, { message: 'La data del ritiro non è valida.' })
  dataPrevista!: string

  @ApiPropertyOptional({ enum: FASCE, nullable: true })
  @IsOptional()
  @IsIn(FASCE, { message: 'La fascia non è valida.' })
  fascia?: (typeof FASCE)[number] | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt({ message: "L'ordine nel giro deve essere un intero positivo." })
  @Min(1, { message: "L'ordine nel giro deve essere un intero positivo." })
  ordineGiro?: number | null

  @IsUUID('all', { message: 'Produttore non valido.' })
  produttoreId!: string

  @IsUUID('all', { message: 'Sede del produttore non valida.' })
  produttoreSedeId!: string

  @IsUUID('all', { message: 'Trasportatore non valido.' })
  trasportatoreId!: string

  @IsUUID('all', { message: 'Destinatario non valido.' })
  destinatarioId!: string

  @IsUUID('all', { message: 'Sede del destinatario non valida.' })
  destinatarioSedeId!: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('all', { message: 'Automezzo non valido.' })
  automezzoId?: string | null

  @IsString()
  @MaxLength(10, { message: 'Il codice CER non è valido.' })
  cerCode!: string

  @IsString({ message: 'La descrizione è obbligatoria.' })
  @MaxLength(500, { message: 'La descrizione può avere al massimo 500 caratteri.' })
  descrizione!: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  statoFisico?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  caratteristichePericolo?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt({ message: 'Il numero di colli non è valido.' })
  @Min(0, { message: 'Il numero di colli non è valido.' })
  @Max(100000, { message: 'Il numero di colli non è valido.' })
  numeroColli?: number | null

  @ApiProperty({
    description: 'Decimale come stringa col punto (max 2 decimali)',
    example: '1250.50',
  })
  @IsString({ message: 'La quantità non è valida.' })
  @MaxLength(20, { message: 'La quantità non è valida.' })
  quantitaPresunta!: string

  @ApiPropertyOptional({ default: 'KG' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  unita?: string

  @ApiProperty({
    description: 'Codice R/D dell’operazione; il tipo (recupero/smaltimento) ne deriva',
  })
  @IsString({ message: "Il codice dell'operazione è obbligatorio." })
  @IsNotEmpty({ message: "Il codice dell'operazione è obbligatorio." })
  @MaxLength(10, { message: "Il codice dell'operazione può avere al massimo 10 caratteri." })
  codiceOperazione!: string

  @ApiPropertyOptional({ enum: PROVENIENZE, nullable: true })
  @IsOptional()
  @IsIn(PROVENIENZE, { message: 'La provenienza non è valida.' })
  provenienza?: (typeof PROVENIENZE)[number] | null

  @ApiPropertyOptional({ enum: TIPI_TRATTA, nullable: true })
  @IsOptional()
  @IsIn(TIPI_TRATTA, { message: 'Il tipo di tratta non è valido.' })
  tipoTratta?: (typeof TIPI_TRATTA)[number] | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  annotazioni?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  noteInterne?: string | null
}

export class RipetizioneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  ogniGiorni?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  ogniSettimane?: number

  @ApiProperty({ example: '2027-01-31' })
  @Matches(DATA, { message: 'La data finale della ripetizione non è valida.' })
  fino!: string
}

export class NuovoRitiroDto extends DatiRitiroDto {
  @ApiProperty({
    description: 'UUID del form: un nuovo tentativo con la stessa chiave non crea doppioni',
  })
  @IsUUID('all', { message: 'La chiave di idempotenza non è valida.' })
  chiaveIdempotenza!: string

  @ApiPropertyOptional({ type: RipetizioneDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RipetizioneDto)
  ripetizione?: RipetizioneDto
}

export class ModificaRitiroDto extends DatiRitiroDto {
  @ApiProperty()
  @IsInt({ message: 'La versione non è valida.' })
  @Min(1, { message: 'La versione non è valida.' })
  versione!: number
}

export class MotivoRitiroDto {
  @ApiProperty({ maxLength: 500 })
  @IsString({ message: 'Il motivo è obbligatorio.' })
  @MaxLength(500, { message: 'Il motivo può avere al massimo 500 caratteri.' })
  motivo!: string

  @ApiProperty()
  @IsInt({ message: 'La versione non è valida.' })
  @Min(1, { message: 'La versione non è valida.' })
  versione!: number
}

export class RiprogrammaRitiroDto {
  @ApiProperty({ example: '2026-11-19' })
  @Matches(DATA, { message: 'La data del ritiro non è valida.' })
  dataPrevista!: string

  @ApiProperty()
  @IsInt({ message: 'La versione non è valida.' })
  @Min(1, { message: 'La versione non è valida.' })
  versione!: number
}

export class GeneraFirDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray({ message: 'Indicare da 1 a 100 ritiri.' })
  @ArrayMinSize(1, { message: 'Indicare da 1 a 100 ritiri.' })
  @ArrayMaxSize(100, { message: 'Indicare da 1 a 100 ritiri.' })
  @IsUUID('all', { each: true, message: 'Ritiro non valido.' })
  ritiroIds!: string[]
}

export class ElencoRitiriQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DATA, { message: 'Data iniziale non valida.' })
  dal?: string

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(DATA, { message: 'Data finale non valida.' })
  al?: string

  @IsOptional()
  @IsUUID('all')
  automezzoId?: string

  @IsOptional()
  @IsUUID('all')
  trasportatoreId?: string

  @IsOptional()
  @IsUUID('all')
  produttoreId?: string

  @IsOptional()
  @IsString()
  @MaxLength(10)
  cerCode?: string

  @ApiPropertyOptional({ enum: STATI_VISIBILI })
  @IsOptional()
  @IsIn(STATI_VISIBILI, { message: 'Stato non valido.' })
  statoVisibile?: (typeof STATI_VISIBILI)[number]

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  dimensione?: number
}
