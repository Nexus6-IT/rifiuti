/**
 * DTO delle rotte `agenti` (4.1b, D17/D22, R37). Il corpo della creazione ha la forma del
 * frontend (`NuovoAgente`): dati della ditta con `partitaIva`/`codiceFiscale`, `indirizzo.comune`
 * (il controller lo mappa su `citta`), `denominazione` e `referente` della sede, piu' `codice`,
 * `note` e `sedeId`. Le regole sui valori (checksum, privato, codice) sono del dominio.
 *
 * `ModificaAgenteDto` non ha gli identificativi della ditta (si correggono sulla ditta, F2-10):
 * con `forbidNonWhitelisted` un `partitaIva` e' 400. Niente `PartialType` (accetterebbe `null`
 * ovunque): solo `codice` e `note` si svuotano con `null`.
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
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { IndirizzoDto } from '../../registry/dto/create-registry.dto'

export class CreaAgenteDto {
  @ApiProperty({ example: 'Agenzia Rossi SRL' })
  @IsString()
  @IsNotEmpty()
  ragioneSociale: string

  @ApiPropertyOptional({
    nullable: true,
    description: 'Un agente privato (senza P.IVA) non e ammesso',
  })
  @IsOptional()
  @IsString()
  partitaIva?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 16 })
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

  @ApiPropertyOptional({
    nullable: true,
    description: 'Fino a 20 caratteri: lettere, cifre, . - _',
  })
  @IsOptional()
  @IsString()
  codice?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Le note non possono superare 2000 caratteri.' })
  note?: string | null

  @ApiPropertyOptional({ description: 'Sede predefinita: una sede attiva della ditta' })
  @IsOptional()
  @IsUUID()
  sedeId?: string
}

export class ModificaAgenteDto {
  @ApiPropertyOptional({ nullable: true, description: 'null toglie il codice' })
  @IsOptional()
  @IsString()
  codice?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'null toglie le note' })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Le note non possono superare 2000 caratteri.' })
  note?: string | null

  @ApiPropertyOptional({ description: 'Nuova sede predefinita (attiva e della stessa ditta)' })
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

/** Query di `GET agenti`: booleani come stringhe `true`/`false` (mai `@Type(() => Boolean)`). */
export class ElencoAgentiQueryDto {
  @ApiPropertyOptional({ description: 'Ragione sociale, codice o partita IVA' })
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
