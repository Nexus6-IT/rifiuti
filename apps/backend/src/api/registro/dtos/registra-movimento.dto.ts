import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  CAUSALI_CARICO,
  CAUSALI_SCARICO,
} from '../../../domain/waste-movement/waste-movement.entity'

const ALL_CAUSALI = [...CAUSALI_CARICO, ...CAUSALI_SCARICO] as const

export class RegistraMovimentoDto {
  @ApiProperty({
    enum: ['CARICO', 'SCARICO'],
    description: 'Tipo di movimento (art. 190 D.Lgs 152/2006)',
  })
  @IsEnum(['CARICO', 'SCARICO'])
  type: 'CARICO' | 'SCARICO'

  @ApiProperty({
    description: "Data effettiva dell'operazione di carico o scarico",
    example: '2026-06-29',
  })
  @IsDateString()
  movementDate: string

  @ApiPropertyOptional({
    description:
      'Data di annotazione nel registro. Se omessa, usa la data corrente. ' +
      'Termine di legge: 10 gg lavorativi per produttori (art. 190 c. 1 lett. a), ' +
      '2 gg lavorativi per gestori impianti (lett. d).',
    example: '2026-06-29',
  })
  @IsDateString()
  @IsOptional()
  registrationDate?: string

  @ApiProperty({
    description:
      'Causale specifica del movimento. ' +
      'CARICO: PRODUZIONE_INTERNA | INGRESSO_ESTERNO | RICLASSIFICAZIONE | RECUPERO_PARZIALE | ALTRO_CARICO. ' +
      'SCARICO: CONFERIMENTO_TRASPORTATORE | AVVIO_RECUPERO | AVVIO_SMALTIMENTO | CESSIONE | RICLASSIFICAZIONE | ALTRO_SCARICO.',
    enum: ALL_CAUSALI,
  })
  @IsIn(ALL_CAUSALI)
  causale: (typeof ALL_CAUSALI)[number]

  @ApiProperty({
    description: 'Codice CER (6 cifre con o senza spazi, es. "200301" o "20 03 01")',
    example: '20 03 01',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  cerCode: string

  @ApiPropertyOptional({ description: 'Descrizione del rifiuto' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  wasteDescription?: string

  @ApiProperty({ description: 'Quantità (kg o unità specificata)', example: 100.5 })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  quantity: number

  @ApiPropertyOptional({ description: 'Unità di misura (default KG)', default: 'KG' })
  @IsString()
  @IsOptional()
  @MaxLength(10)
  unit?: string

  @ApiPropertyOptional({
    description: 'Stato fisico del rifiuto',
    enum: ['Solido', 'Liquido', 'Fangoso', 'Gassoso', 'Polvere', 'Misto'],
  })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  wastePhysicalState?: string

  @ApiPropertyOptional({
    description:
      'Caratteristiche di pericolo HP (es. "HP4,HP14") — obbligatorio per rifiuti pericolosi',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  wasteHazardClasses?: string

  @ApiPropertyOptional({ description: 'Codice operazione di destinazione R/D (es. "R1", "D13")' })
  @IsString()
  @IsOptional()
  @MaxLength(10)
  operationCode?: string

  @ApiPropertyOptional({
    description: 'Denominazione della controparte (cedente per CARICO, destinatario per SCARICO)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  counterpartName?: string

  @ApiPropertyOptional({ description: 'Indirizzo impianto/sede della controparte' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  counterpartAddress?: string

  @ApiPropertyOptional({
    description:
      'ID del FIR collegato (obbligatorio per SCARICO con causale CONFERIMENTO_TRASPORTATORE)',
  })
  @IsUUID()
  @IsOptional()
  firId?: string

  @ApiPropertyOptional({ description: 'Note libere' })
  @IsString()
  @IsOptional()
  notes?: string
}

export class ListMovimentiDto {
  @ApiPropertyOptional({ enum: ['CARICO', 'SCARICO'] })
  @IsEnum(['CARICO', 'SCARICO'])
  @IsOptional()
  type?: 'CARICO' | 'SCARICO'

  @ApiPropertyOptional({ description: 'Filtra per codice CER (ricerca parziale)' })
  @IsString()
  @IsOptional()
  cerCode?: string

  @ApiPropertyOptional({ description: 'Filtra per causale specifica', enum: ALL_CAUSALI })
  @IsIn(ALL_CAUSALI)
  @IsOptional()
  causale?: (typeof ALL_CAUSALI)[number]

  @ApiPropertyOptional({ description: 'Data inizio periodo (YYYY-MM-DD)' })
  @IsDateString()
  @IsOptional()
  dataFrom?: string

  @ApiPropertyOptional({ description: 'Data fine periodo (YYYY-MM-DD)' })
  @IsDateString()
  @IsOptional()
  dataTo?: string

  @ApiPropertyOptional({ description: 'Filtra per ID FIR collegato' })
  @IsUUID()
  @IsOptional()
  firId?: string

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @IsOptional()
  page?: number

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @IsOptional()
  limit?: number
}
