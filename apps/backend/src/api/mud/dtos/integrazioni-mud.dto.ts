import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { normalizzaCodiceFiscaleSoggetto } from '../../../domain/shared/codice-fiscale-soggetto'

// Corpo di `PUT mud/:year/integrazioni` (Decisione 18): il PUT sostituisce le integrazioni
// dell'anno. Qui si verifica solo la forma; carattere di controllo, codice della propria
// azienda, CER e plausibilità del peso specifico li verifica `MudIntegrazioniService`.

const FORMA_CODICE_FISCALE = /^([0-9]{11}|[A-Z0-9]{16})$/
const MESSAGGIO_FORMA_CF = 'Codice fiscale o partita IVA non valido: 11 cifre o 16 caratteri.'

/** Maiuscolo, senza spazi e senza il prefisso `IT` della partita IVA. */
const normalizzaCf = ({ value }: { value: unknown }) =>
  normalizzaCodiceFiscaleSoggetto(typeof value === 'string' ? value : '')

/** Destinatario (modulo DR) senza codice fiscale nel registro o sul FIR. */
export class VoceCfDestinatarioDto {
  @ApiProperty({ example: 'Ecologia Srl' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  ragioneSociale!: string

  @ApiProperty({
    example: '12345678903',
    description: 'Partita IVA o codice fiscale; vuoto solo per un destinatario estero',
  })
  @Transform(normalizzaCf)
  @ValidateIf((v: VoceCfDestinatarioDto) => !v.nazione)
  @Matches(FORMA_CODICE_FISCALE, { message: MESSAGGIO_FORMA_CF })
  codiceFiscale!: string

  @ApiPropertyOptional({
    example: 'Germania',
    description: 'Destinatario estero (A-W-05): nazione al posto del codice fiscale',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nazione?: string

  @ApiPropertyOptional({
    description: "Il codice è quello dell'azienda: il destinatario è un suo impianto (A-W-13)",
  })
  @IsOptional()
  @IsBoolean()
  confermaPropriaAzienda?: boolean
}

/** Destinatario di uno scarico che non ha né FIR né destinatario nel registro (A-W-07). */
export class VoceDestinatarioMovimentoDto {
  @ApiProperty({ example: 2025, description: 'Anno del numero progressivo del movimento' })
  @IsInt()
  anno!: number

  @ApiProperty({ example: 5, description: 'Numero progressivo del movimento' })
  @IsInt()
  @Min(1)
  numero!: number

  @ApiPropertyOptional({
    description:
      'Registro del movimento: lo stesso anno/numero esiste in ogni registro. ' +
      "Senza, la voce vale solo se l'azienda ha un unico registro.",
  })
  @IsOptional()
  @IsUUID()
  registroId?: string

  @ApiProperty({ example: 'Ecologia Srl' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  ragioneSociale!: string

  @ApiProperty({ example: '12345678903' })
  @Transform(normalizzaCf)
  @Matches(FORMA_CODICE_FISCALE, { message: MESSAGGIO_FORMA_CF })
  codiceFiscale!: string

  @ApiPropertyOptional({
    description: "Il codice è quello dell'azienda: il destinatario è un suo impianto (A-W-13)",
  })
  @IsOptional()
  @IsBoolean()
  confermaPropriaAzienda?: boolean
}

/**
 * Trasportatore (modulo TE) senza codice fiscale (A-W-08). Classe propria e non
 * `VoceCfDestinatarioDto`: un trasportatore non ha la nazione al posto del CF, e il codice della
 * propria azienda vale senza conferma (trasporto in conto proprio).
 */
export class VoceTrasportatoreDto {
  @ApiProperty({ example: 'Trasporti Srl' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  ragioneSociale!: string

  @ApiProperty({ example: '12345678903' })
  @Transform(normalizzaCf)
  @Matches(FORMA_CODICE_FISCALE, { message: MESSAGGIO_FORMA_CF })
  codiceFiscale!: string
}

/** Peso specifico di un CER registrato in un'unità diversa da kg e tonnellate. */
export class VocePesoSpecificoDto {
  // Niente regex di cifre (preflight F36): le 6 cifre le verifica il servizio con cer-registro.
  @ApiProperty({ example: '170405' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  cerCode!: string

  @ApiProperty({ example: 'litri' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  unita!: string

  @ApiProperty({ example: 1.1 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(100000)
  kgPerUnita!: number

  @ApiPropertyOptional({
    description: "Obbligatoria (true) se il valore è fuori dall'intervallo consueto per l'unità",
  })
  @IsOptional()
  @IsBoolean()
  confermaFuoriIntervallo?: boolean
}

export class IntegrazioniMudDto {
  @ApiProperty({ type: [VoceCfDestinatarioDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoceCfDestinatarioDto)
  destinatari!: VoceCfDestinatarioDto[]

  @ApiProperty({ type: [VocePesoSpecificoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VocePesoSpecificoDto)
  pesiSpecifici!: VocePesoSpecificoDto[]

  // Facoltative (preflight F32): assenti valgono come liste vuote. La pagina le manda sempre.
  @ApiPropertyOptional({ type: [VoceDestinatarioMovimentoDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoceDestinatarioMovimentoDto)
  destinatariMovimento?: VoceDestinatarioMovimentoDto[]

  @ApiPropertyOptional({ type: [VoceTrasportatoreDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoceTrasportatoreDto)
  trasportatori?: VoceTrasportatoreDto[]
}
