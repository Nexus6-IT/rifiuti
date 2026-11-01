/**
 * DTO delle rotte `contratti-clienti` (4.1b, Task 18, D9, D11, D17, R37, R43). Qui solo forma,
 * lunghezze e tipi; le regole sui valori (checksum, SDI, periodi, esigibilita', stati) sono del
 * dominio, che le rifa comunque sul corpo normalizzato.
 *
 * Le date sono GIORNI `YYYY-MM-DD` (mai un istante), gli importi e le percentuali stringhe
 * decimali col punto (R2: un numero JSON perde i decimali). `stato` NON e' ammesso nel corpo di
 * creazione (un contratto nasce in bozza) ne' in quello di modifica (si cambia con `PATCH :id/stato`):
 * con `forbidNonWhitelisted` e' 400. `ModificaContrattoClienteDto` e' parziale: campo assente =
 * invariato, `null` = svuota (il dominio rifiuta `null` sui campi obbligatori con il loro messaggio).
 * I booleani delle query sono stringhe `true`/`false`, i numeri passano da `@Type(() => Number)`.
 */
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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

const STATI = ['BOZZA', 'ATTIVO', 'SOSPESO', 'SOSPESO_MOVIMENTI', 'ANNULLATO']
const ESIGIBILITA = ['IMMEDIATA', 'DIFFERITA', 'SCISSIONE']
const GIORNO = /^\d{4}-\d{2}-\d{2}$/

const MSG_GIORNO = 'La data deve essere un giorno valido nel formato AAAA-MM-GG.'
const MSG_RITENUTA =
  'La ritenuta è una stringa decimale col punto (es. "4.50"), con al massimo 2 cifre intere e 2 decimali.'
const MSG_SOGLIA =
  'La soglia è una stringa decimale col punto (es. "1500.00"), con al massimo 10 cifre intere e 2 decimali.'
const MSG_PERIODI = 'Al massimo 12 periodi di fatturazione.'
const MSG_ANNOTAZIONI = 'Al massimo 3 annotazioni di 45 caratteri ciascuna.'
const MSG_SDI = 'Il codice destinatario SDI deve avere al massimo 7 caratteri.'

/** Un giorno `YYYY-MM-DD` reale: `IsISO8601 strict` rifiuta il 30 febbraio, il pattern la forma. */
const giorno = () => (target: object, chiave: string) => {
  IsISO8601({ strict: true }, { message: MSG_GIORNO })(target, chiave)
  Matches(GIORNO, { message: MSG_GIORNO })(target, chiave)
}

export class PeriodoFatturazioneDto {
  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  giornoInizio: number

  @ApiProperty({ minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  meseInizio: number

  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  giornoFine: number

  @ApiProperty({ minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  meseFine: number
}

export class CreaContrattoClienteDto {
  @ApiProperty({ example: 'CC-2026-001', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50, { message: 'Il numero non può superare 50 caratteri.' })
  numero: string

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'La descrizione non può superare 255 caratteri.' })
  descrizione: string

  @ApiProperty()
  @IsUUID()
  clienteId: string

  @ApiProperty({ example: '2026-01-01' })
  @giorno()
  dataInizio: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  clienteFatturazioneId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  sedeId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  categoriaId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  tipoId?: string | null

  @ApiPropertyOptional({ nullable: true, example: '2026-12-31' })
  @IsOptional()
  @giorno()
  dataFine?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @giorno()
  dataStipula?: string | null

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 999 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  validitaQuantita?: number | null

  @ApiPropertyOptional({ nullable: true, enum: ['A', 'S', 'M', 'G'] })
  @IsOptional()
  @IsIn(['A', 'S', 'M', 'G'])
  validitaUnita?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  contrattoPrincipaleId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  condizionePagamentoId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  contoCorrenteId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  speseIncassoId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  bolloId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  registroIvaId?: string | null

  @ApiPropertyOptional({ nullable: true, enum: ESIGIBILITA })
  @IsOptional()
  @IsIn(ESIGIBILITA)
  esigibilitaIva?: string | null

  @ApiPropertyOptional({
    nullable: true,
    example: '4.50',
    description: 'Stringa decimale col punto',
  })
  @IsOptional()
  @IsString({ message: MSG_RITENUTA })
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, { message: MSG_RITENUTA })
  ritenutaPercentuale?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  agenteId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  testoFatturazioneId?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 7 })
  @IsOptional()
  @IsString()
  @MaxLength(7, { message: MSG_SDI })
  codiceDestinatario?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Il riferimento amministrazione non può superare 20 caratteri.' })
  riferimentoAmministrazione?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 15 })
  @IsOptional()
  @IsString()
  @MaxLength(15, { message: 'Il CIG non può superare 15 caratteri.' })
  codiceCig?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 15 })
  @IsOptional()
  @IsString()
  @MaxLength(15, { message: 'Il CUP non può superare 15 caratteri.' })
  codiceCup?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Il documento della PA non può superare 20 caratteri.' })
  idDocumentoPa?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  escludiDichiarazioneIntento?: boolean

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @giorno()
  sogliaDal?: string | null

  @ApiPropertyOptional({
    nullable: true,
    example: '1500.00',
    description: 'Stringa decimale col punto',
  })
  @IsOptional()
  @IsString({ message: MSG_SOGLIA })
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: MSG_SOGLIA })
  sogliaImporto?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sogliaIvaEsclusa?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rinnovoAutomatico?: boolean

  @ApiPropertyOptional({ nullable: true, enum: ['S', 'N'], description: 'S spunta, N toglie' })
  @IsOptional()
  @IsIn(['S', 'N'])
  codiceRinnovo?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  incrementoIstat?: boolean

  @ApiPropertyOptional({ nullable: true, maxLength: 12 })
  @IsOptional()
  @IsString()
  @MaxLength(12, { message: 'La commessa non può superare 12 caratteri.' })
  commessa?: string | null

  @ApiPropertyOptional({ type: [String], maxItems: 3 })
  @IsOptional()
  @IsArray({ message: MSG_ANNOTAZIONI })
  @ArrayMaxSize(3, { message: MSG_ANNOTAZIONI })
  @IsString({ each: true, message: MSG_ANNOTAZIONI })
  @MaxLength(45, { each: true, message: MSG_ANNOTAZIONI })
  annotazioni?: string[]

  @ApiPropertyOptional({ type: [PeriodoFatturazioneDto], maxItems: 12 })
  @IsOptional()
  @IsArray({ message: MSG_PERIODI })
  @ArrayMaxSize(12, { message: MSG_PERIODI })
  @ValidateNested({ each: true })
  @Type(() => PeriodoFatturazioneDto)
  periodi?: PeriodoFatturazioneDto[]
}

export class ModificaContrattoClienteDto extends PartialType(CreaContrattoClienteDto) {
  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}

export class CambiaStatoContrattoClienteDto {
  @ApiProperty({ enum: STATI })
  @IsIn(STATI)
  stato: string

  @ApiProperty()
  @IsInt()
  @Min(1)
  versione: number

  @ApiPropertyOptional({ nullable: true, description: 'Codifica di genere MOTIVO_ANNULLO' })
  @IsOptional()
  @IsUUID()
  motivoAnnulloId?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: "Il motivo dell'annullo non può superare 255 caratteri." })
  motivo?: string | null
}

export class RinnovaContrattoClienteDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  versione: number
}

export class ProrogaScadenzeDto {
  @ApiProperty({
    example: '2026-12-31',
    description: 'Si prorogano i contratti con fine entro il giorno',
  })
  @giorno()
  scadutiEntro: string

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  soloRinnovoAutomatico?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  ancheSospesi?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoriaId?: string
}

/** Query di `GET contratti-clienti` (R37, R43). */
export class ElencoContrattiClienteQueryDto {
  @ApiPropertyOptional({ enum: STATI })
  @IsOptional()
  @IsIn(STATI)
  stato?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoriaId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tipoId?: string

  @ApiPropertyOptional({
    description: 'Numero, descrizione, commessa o ragione sociale del cliente',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  testo?: string

  @ApiPropertyOptional({ minimum: 0, description: 'Contratti con fine entro N giorni da oggi' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  inScadenzaEntroGiorni?: number

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
