import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator'
import { eGiornoValido } from '../../../application/registro/causali/causali-registro.service'

/** Verso della causale: lo stesso insieme del tipo di movimento. */
export enum VersoCausaleDto {
  CARICO = 'CARICO',
  SCARICO = 'SCARICO',
}

export enum RuoloMudCausaleDto {
  PRODOTTO = 'PRODOTTO',
  AVVIATO = 'AVVIATO',
  RICEVUTO_DA_TERZI = 'RICEVUTO_DA_TERZI',
  ESCLUSO = 'ESCLUSO',
}

/** Codici di comportamento verso RENTRI ammessi (C1/C4); la coerenza col verso la verifica il servizio. */
export const CODICI_RENTRI = ['DT', 'NP', 'T*', 'RE', 'I', 'aT', 'M'] as const
export const OPERAZIONI = ['R', 'D'] as const

const FORMATO_GIORNO = /^\d{4}-\d{2}-\d{2}$/
const MESSAGGIO_GIORNO = 'deve essere una data reale nel formato AAAA-MM-GG'

/** Giorno di calendario che esiste davvero (31/02 no). */
function GiornoReale(opzioni?: ValidationOptions): PropertyDecorator {
  return (oggetto, proprieta) =>
    registerDecorator({
      name: 'giornoReale',
      target: oggetto.constructor,
      propertyName: proprieta as string,
      options: { message: `${String(proprieta)} ${MESSAGGIO_GIORNO}`, ...opzioni },
      validator: { validate: (valore: unknown) => eGiornoValido(valore) },
    })
}

const MESSAGGIO_FATTURABILE = 'fatturabile deve essere true o false'

const tagliaSpazi = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

// ---------------------------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------------------------

export class ListaCausaliQueryDto {
  @ApiProperty({ enum: VersoCausaleDto })
  @IsEnum(VersoCausaleDto)
  tipo: VersoCausaleDto

  @ApiPropertyOptional({ description: 'Giorno AAAA-MM-GG; assente = oggi', example: '2026-10-28' })
  @IsOptional()
  @Matches(FORMATO_GIORNO, { message: `data ${MESSAGGIO_GIORNO}` })
  @GiornoReale()
  data?: string
}

// ---------------------------------------------------------------------------------------------
// Corpi
// ---------------------------------------------------------------------------------------------

export class CreaCausaleAziendaleDto {
  @ApiProperty({ example: 'AZ_RESO_CLIENTE' })
  @IsString()
  @Matches(/^AZ_[A-Z0-9_]{2,40}$/, {
    message: 'codice deve iniziare con AZ_ e contenere da 2 a 40 lettere maiuscole, cifre o _',
  })
  codice: string

  @ApiProperty({ enum: VersoCausaleDto })
  @IsEnum(VersoCausaleDto)
  verso: VersoCausaleDto

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(tagliaSpazi)
  @IsString()
  @Length(1, 200)
  descrizione: string

  @ApiProperty({ enum: RuoloMudCausaleDto })
  @IsEnum(RuoloMudCausaleDto)
  ruoloMud: RuoloMudCausaleDto

  @ApiPropertyOptional({ enum: CODICI_RENTRI })
  @IsOptional()
  @IsIn(CODICI_RENTRI)
  codiceRentri?: string

  @ApiPropertyOptional({ enum: OPERAZIONI })
  @IsOptional()
  @IsIn(OPERAZIONI)
  operazione?: string

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  ordine?: number

  @ApiPropertyOptional({
    description: 'Le registrazioni con questa causale sono candidate alla fatturazione',
  })
  @ValidateIf(o => o.fatturabile !== undefined)
  @IsBoolean({ message: MESSAGGIO_FATTURABILE })
  fatturabile?: boolean

  @ApiPropertyOptional({ example: '2026-10-28' })
  @IsOptional()
  @Matches(FORMATO_GIORNO, { message: `validaDal ${MESSAGGIO_GIORNO}` })
  @GiornoReale()
  validaDal?: string
}

/**
 * PATCH: campo assente = invariato; `null` = azzera, ammesso SOLO per `codiceRentri` e
 * `operazione` (`@IsOptional` lascia passare null e undefined). Per gli altri campi il
 * `@ValidateIf(!== undefined)` fa validare anche `null`, che quindi e' un 400.
 */
export class ModificaCausaleAziendaleDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf(o => o.descrizione !== undefined)
  @Transform(tagliaSpazi)
  @IsString()
  @Length(1, 200)
  descrizione?: string

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @ValidateIf(o => o.ordine !== undefined)
  @IsInt()
  @Min(0)
  @Max(9999)
  ordine?: number

  @ApiPropertyOptional({ enum: RuoloMudCausaleDto })
  @ValidateIf(o => o.ruoloMud !== undefined)
  @IsEnum(RuoloMudCausaleDto)
  ruoloMud?: RuoloMudCausaleDto

  @ApiPropertyOptional({ enum: CODICI_RENTRI, nullable: true })
  @IsOptional()
  @IsIn(CODICI_RENTRI)
  codiceRentri?: string | null

  @ApiPropertyOptional({ enum: OPERAZIONI, nullable: true })
  @IsOptional()
  @IsIn(OPERAZIONI)
  operazione?: string | null

  @ApiPropertyOptional({
    description: 'Le registrazioni con questa causale sono candidate alla fatturazione',
  })
  @ValidateIf(o => o.fatturabile !== undefined)
  @IsBoolean({ message: MESSAGGIO_FATTURABILE })
  fatturabile?: boolean

  @ApiPropertyOptional({ example: '2026-10-28' })
  @ValidateIf(o => o.validaDal !== undefined)
  @Matches(FORMATO_GIORNO, { message: `validaDal ${MESSAGGIO_GIORNO}` })
  @GiornoReale()
  validaDal?: string
}

export class NuovaVersioneCausaleDto {
  @ApiProperty({ example: '2026-11-01' })
  @Matches(FORMATO_GIORNO, { message: `validaDal ${MESSAGGIO_GIORNO}` })
  @GiornoReale()
  validaDal: string

  @ApiProperty({ enum: RuoloMudCausaleDto })
  @IsEnum(RuoloMudCausaleDto)
  ruoloMud: RuoloMudCausaleDto

  @ApiPropertyOptional({ enum: CODICI_RENTRI })
  @IsOptional()
  @IsIn(CODICI_RENTRI)
  codiceRentri?: string

  @ApiPropertyOptional({ enum: OPERAZIONI })
  @IsOptional()
  @IsIn(OPERAZIONI)
  operazione?: string

  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf(o => o.descrizione !== undefined)
  @Transform(tagliaSpazi)
  @IsString()
  @Length(1, 200)
  descrizione?: string

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @ValidateIf(o => o.ordine !== undefined)
  @IsInt()
  @Min(0)
  @Max(9999)
  ordine?: number

  @ApiPropertyOptional({
    description: 'Le registrazioni con questa causale sono candidate alla fatturazione',
  })
  @ValidateIf(o => o.fatturabile !== undefined)
  @IsBoolean({ message: MESSAGGIO_FATTURABILE })
  fatturabile?: boolean
}

export class ChiudiCausaleDto {
  @ApiProperty({ example: '2026-12-31' })
  @Matches(FORMATO_GIORNO, { message: `validaAl ${MESSAGGIO_GIORNO}` })
  @GiornoReale()
  validaAl: string
}
