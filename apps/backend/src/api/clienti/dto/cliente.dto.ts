/**
 * DTO delle rotte `clienti` (4.1b, D3, D17, R37). Il corpo della creazione ha la forma del
 * frontend (`NuovoCliente`): dati della ditta con `partitaIva`/`codiceFiscale`, `indirizzo.comune`
 * (il controller lo mappa su `citta`), `denominazione` e `referente` della sede, piu' i dati
 * fiscali e di fatturazione del cliente. Le regole sui valori (checksum, privato, SDI, IBAN)
 * sono del dominio; qui solo forma, lunghezze e tipi.
 *
 * `ModificaClienteDto` non ha gli identificativi della ditta ne' l'indirizzo (si correggono sulla
 * ditta, F2-10): con `forbidNonWhitelisted` un `partitaIva` e' 400. `null` svuota un campo,
 * assente lascia invariato. Niente `PartialType`. Nessun messaggio riporta il valore ricevuto.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { IndirizzoDto } from '../../registry/dto/create-registry.dto'

const ESIGIBILITA = ['IMMEDIATA', 'DIFFERITA', 'SCISSIONE']
const MSG_SDI = 'Il codice destinatario SDI deve avere al massimo 7 caratteri.'
const TIPI_PROVVIGIONE = ['SCONTATO', 'LORDO']
const MSG_LISTINO = 'Il listino del cliente va da 1 a 6.'
const MSG_PROVVIGIONE =
  'La provvigione predefinita si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.'
const MSG_TIPO_PROVVIGIONE = 'Il tipo di provvigione del cliente non è ammesso (scontato o lordo).'
const MSG_RITENUTA =
  'La ritenuta è una stringa decimale col punto (es. "4.50"), con al massimo 2 cifre intere e 2 decimali.'

/** Campi fiscali e di fatturazione, comuni a creazione e modifica (tutti facoltativi, null ammesso). */
class DatiFiscaliClienteDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Fino a 20 caratteri: lettere, cifre, . - _',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  codice?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 7 })
  @IsOptional()
  @IsString()
  @MaxLength(7, { message: MSG_SDI })
  codiceDestinatario?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pecFatturazione?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Il riferimento amministrazione non può superare 20 caratteri.' })
  riferimentoAmministrazione?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  iban?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  contoCorrenteId?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  condizionePagamentoId?: string | null

  @ApiPropertyOptional({ enum: ESIGIBILITA, nullable: true })
  @IsOptional()
  @IsIn(ESIGIBILITA)
  esigibilitaIva?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  registroIvaId?: string | null

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
  agenteId?: string | null

  @ApiPropertyOptional({
    nullable: true,
    example: '4.50',
    description: 'Stringa decimale col punto',
  })
  @IsOptional()
  @IsString({ message: MSG_RITENUTA })
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, { message: MSG_RITENUTA })
  ritenutaPercentuale?: string | null

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: 6,
    description: 'Listino del cliente (4.2a, D7); predefinito della riga, non del contratto',
  })
  @IsOptional()
  @IsInt({ message: MSG_LISTINO })
  @Min(1, { message: MSG_LISTINO })
  @Max(6, { message: MSG_LISTINO })
  listino?: number | null

  @ApiPropertyOptional({
    nullable: true,
    example: '10+5',
    description: 'Provvigione predefinita a cascata (stringa, mai numero); va col tipo',
  })
  @IsOptional()
  @IsString({ message: MSG_PROVVIGIONE })
  @MaxLength(40, { message: MSG_PROVVIGIONE })
  provvigionePredefinita?: string | null

  @ApiPropertyOptional({ enum: TIPI_PROVVIGIONE, nullable: true })
  @IsOptional()
  @IsIn(TIPI_PROVVIGIONE, { message: MSG_TIPO_PROVVIGIONE })
  tipoProvvigionePredefinita?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Solo per il cliente persona fisica' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nome?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Solo per il cliente persona fisica' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  cognome?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Le note non possono superare 2000 caratteri.' })
  note?: string | null
}

export class CreaClienteDto extends DatiFiscaliClienteDto {
  @ApiProperty({ example: 'Cliente Rossi SRL' })
  @IsString()
  @IsNotEmpty()
  ragioneSociale: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  partitaIva?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 16, description: 'Da solo = cliente privato' })
  @IsOptional()
  @IsString()
  @MaxLength(16, {
    message:
      'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite',
  })
  codiceFiscale?: string | null

  @ApiProperty({ type: IndirizzoDto })
  @IsDefined()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => IndirizzoDto)
  indirizzo: IndirizzoDto

  @ApiPropertyOptional({ nullable: true, description: 'Denominazione della sede' })
  @IsOptional()
  @IsString()
  denominazione?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  referente?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  email?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  telefono?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  pec?: string | null

  @ApiPropertyOptional({ description: 'Sede di fatturazione: una sede attiva della ditta' })
  @IsOptional()
  @IsUUID()
  sedeId?: string
}

export class ModificaClienteDto extends DatiFiscaliClienteDto {
  @ApiPropertyOptional({ description: 'Nuova sede di fatturazione (attiva e della stessa ditta)' })
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  sedeId?: string

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attivo?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}

/** Query di `GET clienti`: booleani come stringhe `true`/`false` (mai `@Type(() => Boolean)`). */
export class ElencoClientiQueryDto {
  @ApiPropertyOptional({
    description: 'Ragione sociale, codice o partita IVA (mai il codice fiscale)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  testo?: string

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
