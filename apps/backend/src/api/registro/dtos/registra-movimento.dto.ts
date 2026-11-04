import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { MaxDecimali } from '../../../core/validators/max-decimali'
/** Forma di un codice causale: di sistema (`CESSIONE`) o dell'azienda (`AZ_...`). */
const FORMATO_CAUSALE = /^[A-Z][A-Z0-9_]*$/

/**
 * Enum dei tipi di movimento. Definito come enum (non array-literal) così che
 * `@IsEnum` produca un messaggio d'errore con l'elenco dei valori validi
 * ("must be one of the following values: CARICO, SCARICO").
 */
export enum WasteMovementTypeEnum {
  CARICO = 'CARICO',
  SCARICO = 'SCARICO',
}

/** Ritocco di una riga proposta (numeri come stringhe col punto: li valida il dominio). */
export class RigaLegameRegistrazioneDto {
  @ApiProperty()
  @IsUUID()
  rigaAddebitoId: string

  @ApiPropertyOptional({ nullable: true, description: 'Quantità > 0, al massimo 3 decimali' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  quantita?: string | null

  @ApiPropertyOptional({ description: 'Prezzo >= 0, al massimo 6 decimali' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  prezzo?: string

  @ApiPropertyOptional({ nullable: true, description: 'Formula di sconto a cascata' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sconto?: string | null

  @ApiPropertyOptional({ description: 'Non ammesso in registrazione' })
  @IsOptional()
  @IsBoolean()
  rimuovi?: boolean
}

/** Blocco «Fatturazione» della registrazione (fase 4.3, spec §7.1). */
export class LegameRegistrazioneDto {
  @ApiProperty({ enum: ['CONFERMA', 'PROPOSTA'] })
  @IsIn(['CONFERMA', 'PROPOSTA'])
  azione: 'CONFERMA' | 'PROPOSTA'

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  clienteId?: string

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  contrattoId?: string

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  elencoId?: string

  @ApiPropertyOptional({ type: [RigaLegameRegistrazioneDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RigaLegameRegistrazioneDto)
  @IsOptional()
  righe?: RigaLegameRegistrazioneDto[]
}

export class RegistraMovimentoDto {
  @ApiProperty({
    enum: WasteMovementTypeEnum,
    description: 'Tipo di movimento (art. 190 D.Lgs 152/2006)',
  })
  @IsEnum(WasteMovementTypeEnum)
  type: 'CARICO' | 'SCARICO'

  @ApiProperty({
    description: "Data effettiva dell'operazione di carico o scarico",
    example: '2026-06-29',
  })
  @IsDateString()
  movementDate: string

  @ApiPropertyOptional({
    description:
      'Ignorata: la data di registrazione la assegna il server al momento della conferma. ' +
      'Resta accettata per compatibilità con i client esistenti.',
    example: '2026-06-29',
  })
  @IsDateString()
  @IsOptional()
  registrationDate?: string

  @ApiProperty({
    description:
      'Codice della causale del movimento: una di sistema (es. PRODUZIONE_INTERNA, CESSIONE) o una ' +
      "dell'azienda (prefisso AZ_). L'elenco valido per tipo e data lo dà GET registro/causali.",
    example: 'PRODUZIONE_INTERNA',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(FORMATO_CAUSALE, { message: 'causale deve essere un codice in maiuscolo (A-Z, 0-9, _)' })
  causale: string

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
  @MaxDecimali(2, 'La quantità')
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

  @ApiPropertyOptional({
    description:
      'Registro (uuid, di una sede) in cui registrare. Senza: registro della sede principale, ' +
      "o l'unico registro attivo.",
  })
  @IsUUID()
  @IsOptional()
  registroId?: string

  @ApiPropertyOptional({
    type: LegameRegistrazioneDto,
    description:
      'Blocco «Fatturazione» (causali fatturabili): CONFERMA o PROPOSTA del legame con cliente e ' +
      'prezzo. Senza il blocco il legame nasce come proposta. Un errore nel legame non annulla ' +
      'mai la registrazione.',
  })
  @ValidateNested()
  @Type(() => LegameRegistrazioneDto)
  @IsOptional()
  legame?: LegameRegistrazioneDto
}

export class ListMovimentiDto {
  @ApiPropertyOptional({ enum: WasteMovementTypeEnum })
  @IsEnum(WasteMovementTypeEnum)
  @IsOptional()
  type?: 'CARICO' | 'SCARICO'

  @ApiPropertyOptional({ description: 'Filtra per codice CER (ricerca parziale)' })
  @IsString()
  @IsOptional()
  cerCode?: string

  @ApiPropertyOptional({ description: 'Filtra per codice causale esatto' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  causale?: string

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

  @ApiPropertyOptional({ description: 'Filtra per registro (uuid)' })
  @IsUUID()
  @IsOptional()
  registroId?: string

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
