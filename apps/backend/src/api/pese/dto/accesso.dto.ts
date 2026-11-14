import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  Equals,
  IsIn,
  IsInt,
  IsDefined,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { MaxDecimali } from '../../../core/validators/max-decimali'

/** Motivo libero: trim e poi 1..500 caratteri. */
const senzaSpazi = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/**
 * Pesata inserita a mano. ATTENZIONE: una pesata manuale NON ha garanzia metrologica
 * (non arriva da uno strumento collegato): resta tracciata come tale.
 */
export class PesataManualeDto {
  @ApiProperty({ description: 'Peso in kg, al massimo 2 decimali', minimum: 0.01 })
  @MaxDecimali(2, 'Il peso', { message: 'Il peso deve avere al massimo due decimali.' })
  @Min(0.01, { message: 'Il peso deve essere positivo.' })
  @Max(99999999.99, { message: 'Il peso supera il massimo ammesso.' })
  pesoKg!: number

  @ApiPropertyOptional({ nullable: true, description: 'Strumento di pesa dell’azienda' })
  @IsOptional()
  @IsUUID('all', { message: 'Strumento non valido.' })
  strumentoId?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'Strumento esterno non valido.' })
  @MaxLength(200, { message: 'Lo strumento esterno può avere al massimo 200 caratteri.' })
  strumentoEsterno?: string | null

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 40,
    description: 'Memoria alibi dello strumento',
  })
  @IsOptional()
  @IsString({ message: 'Memoria alibi non valida.' })
  @MaxLength(40, { message: 'La memoria alibi può avere al massimo 40 caratteri.' })
  alibiId?: string | null

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ora indicata dallo strumento, ISO 8601 con fuso',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'L’ora dello strumento non è valida.' })
  @Matches(/(Z|[+-]\d{2}:?\d{2})$/i, {
    message: 'L’ora dello strumento deve indicare il fuso orario (es. +02:00).',
  })
  @MaxLength(40, { message: 'L’ora dello strumento non è valida.' })
  oraStrumento?: string | null

  @ApiProperty({ maxLength: 500, description: 'Perché la pesata è stata inserita a mano' })
  @IsString({ message: 'Il motivo è obbligatorio.' })
  @Transform(senzaSpazi)
  @Length(1, 500, { message: 'Il motivo è obbligatorio (al massimo 500 caratteri).' })
  motivo!: string

  @ApiProperty({ enum: [true] })
  @Equals(true, { message: 'Confermare che il display indicava un peso stabile.' })
  stabileDichiarato!: true
}

/** Pesata presa da una lettura firmata dell'agente di pesa: il peso non si digita (4.8b, D12). */
export class PesataDaLetturaDto {
  @ApiProperty({ description: 'Lettura dello strumento arrivata dall’agente' })
  @IsUUID('all', { message: 'Lettura non valida.' })
  letturaId!: string
}

/** Sceglie il DTO dalla forma dell'oggetto: con `letturaId` e' una lettura, altrimenti manuale. */
const tipoPesata = ({ object }: { object: Record<string, unknown> }) =>
  object?.pesata && typeof object.pesata === 'object' && 'letturaId' in object.pesata
    ? PesataDaLetturaDto
    : PesataManualeDto

export class AperturaAccessoDto {
  @ApiProperty({ description: 'Chiave di idempotenza scelta dal client (UUID)' })
  @IsUUID('all', { message: 'Chiave di idempotenza non valida.' })
  chiaveIdempotenza!: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('all', { message: 'Registro non valido.' })
  registroId?: string | null

  @ApiProperty({ enum: ['CARICO', 'SCARICO'] })
  @IsIn(['CARICO', 'SCARICO'], { message: 'Verso non valido.' })
  verso!: 'CARICO' | 'SCARICO'

  @ApiProperty({ enum: ['DOPPIA', 'TARA_ANAGRAFICA', 'SINGOLA'] })
  @IsIn(['DOPPIA', 'TARA_ANAGRAFICA', 'SINGOLA'], { message: 'Modo di pesatura non valido.' })
  modo!: 'DOPPIA' | 'TARA_ANAGRAFICA' | 'SINGOLA'

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('all', { message: 'Automezzo non valido.' })
  automezzoId?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 40 })
  @IsOptional()
  @IsString({ message: 'Targa non valida.' })
  @MaxLength(40, { message: 'Targa non valida.' })
  targa?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 40 })
  @IsOptional()
  @IsString({ message: 'Targa del rimorchio non valida.' })
  @MaxLength(40, { message: 'Targa del rimorchio non valida.' })
  targaRimorchio?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 20 })
  @IsOptional()
  @IsString({ message: 'Codice CER non valido.' })
  @MaxLength(20, { message: 'Codice CER non valido.' })
  cerCode?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 255 })
  @IsOptional()
  @IsString({ message: 'La descrizione non è valida.' })
  @MaxLength(255, { message: 'La descrizione può avere al massimo 255 caratteri.' })
  descrizione?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString({ message: 'Le note non sono valide.' })
  @MaxLength(1000, { message: 'Le note possono avere al massimo 1000 caratteri.' })
  note?: string | null

  @ApiProperty({
    oneOf: [{ $ref: getSchemaPath(PesataManualeDto) }, { $ref: getSchemaPath(PesataDaLetturaDto) }],
  })
  @IsDefined({ message: 'Mancano i dati della pesata.' })
  @IsObject({ message: 'I dati della pesata non sono validi.' })
  @ValidateNested()
  @Type(tipoPesata as never)
  pesata!: PesataManualeDto | PesataDaLetturaDto
}

export class SecondaPesataDto {
  @ApiProperty({ description: 'Chiave di idempotenza della seconda pesata (UUID)' })
  @IsUUID('all', { message: 'Chiave di idempotenza non valida.' })
  chiaveIdempotenza!: string

  @ApiProperty({
    oneOf: [{ $ref: getSchemaPath(PesataManualeDto) }, { $ref: getSchemaPath(PesataDaLetturaDto) }],
  })
  @IsDefined({ message: 'Mancano i dati della pesata.' })
  @IsObject({ message: 'I dati della pesata non sono validi.' })
  @ValidateNested()
  @Type(tipoPesata as never)
  pesata!: PesataManualeDto | PesataDaLetturaDto
}

export class RettificaDto {
  @ApiProperty({ description: 'Nuovo peso in kg, al massimo 2 decimali' })
  @MaxDecimali(2, 'Il peso', { message: 'Il peso deve avere al massimo due decimali.' })
  @Min(0.01, { message: 'Il peso deve essere positivo.' })
  @Max(99999999.99, { message: 'Il peso supera il massimo ammesso.' })
  pesoNuovoKg!: number

  @ApiProperty({ maxLength: 500 })
  @IsString({ message: 'Il motivo è obbligatorio.' })
  @Transform(senzaSpazi)
  @Length(1, 500, { message: 'Il motivo è obbligatorio (al massimo 500 caratteri).' })
  motivo!: string
}

export class MotivoDto {
  @ApiProperty({ maxLength: 500 })
  @IsString({ message: 'Il motivo è obbligatorio.' })
  @Transform(senzaSpazi)
  @Length(1, 500, { message: 'Il motivo è obbligatorio (al massimo 500 caratteri).' })
  motivo!: string
}

export class CollegamentoDto {
  @ApiProperty({ enum: ['FIR', 'MOVIMENTO'] })
  @IsIn(['FIR', 'MOVIMENTO'], { message: 'Tipo di collegamento non valido.' })
  tipo!: 'FIR' | 'MOVIMENTO'

  @ApiPropertyOptional({ description: 'Obbligatorio con tipo FIR' })
  @IsOptional()
  @IsUUID('all', { message: 'FIR non valido.' })
  firId?: string

  @ApiPropertyOptional({ description: 'Annotazione di registro, obbligatoria con tipo MOVIMENTO' })
  @IsOptional()
  @IsUUID('all', { message: 'Movimento non valido.' })
  movimentoId?: string
}

export class FiltriAccessiQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Registro non valido.' })
  registroId?: string

  @ApiPropertyOptional({ enum: ['APERTO', 'CHIUSO', 'ANNULLATO'] })
  @IsOptional()
  @IsIn(['APERTO', 'CHIUSO', 'ANNULLATO'], { message: 'Stato non valido.' })
  stato?: 'APERTO' | 'CHIUSO' | 'ANNULLATO'

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (giorno italiano)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data "dal" non valida (AAAA-MM-GG).' })
  dal?: string

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (giorno italiano)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data "al" non valida (AAAA-MM-GG).' })
  al?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Targa non valida.' })
  @MinLength(1, { message: 'Targa non valida.' })
  @MaxLength(40, { message: 'Targa non valida.' })
  targa?: string

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Pagina non valida.' })
  @Min(1, { message: 'Pagina non valida.' })
  @Max(100000, { message: 'Pagina non valida.' })
  pagina?: number
}
