/**
 * DTO delle rotte `registri-iva` (4.1a, D24/D17). Il DTO controlla forma e tipi; le regole sui
 * valori (codice di due cifre 01-99, lunghezza della descrizione) sono del dominio e rispondono
 * con l'elenco dei messaggi in italiano.
 *
 * `ModificaRegistroIvaDto` non usa `PartialType` (che accetta anche `null`): un campo o manca, o ha
 * il tipo giusto; `null` e' 400.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsString, Matches, Min, ValidateIf } from 'class-validator'
import {
  MSG_SUFFISSO_NON_VALIDO,
  SUFFISSO_REGEX,
} from '../../../application/fatturazione/suffisso-registro'

export class CreaRegistroIvaDto {
  @ApiProperty({ example: '01', description: 'Due cifre, da 01 a 99 (una cifra sola si completa)' })
  @IsString()
  codice: string

  @ApiProperty({ example: 'Vendite' })
  @IsString()
  descrizione: string

  @ApiProperty({
    example: false,
    description: 'true = registro delle ricevute split payment (non si usa per i contratti)',
  })
  @IsBoolean()
  ricevuteSplit: boolean

  @ApiPropertyOptional({
    nullable: true,
    example: '/A',
    description: '1-10 caratteri [A-Za-z0-9/-]; null o omesso = nessun suffisso',
  })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @Matches(SUFFISSO_REGEX, { message: MSG_SUFFISSO_NON_VALIDO })
  suffissoNumero?: string | null
}

export class ModificaRegistroIvaDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  codice?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  descrizione?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  ricevuteSplit?: boolean

  @ApiPropertyOptional({
    nullable: true,
    example: '/A',
    description: '1-10 caratteri [A-Za-z0-9/-]; null = togli il suffisso',
  })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @Matches(SUFFISSO_REGEX, { message: MSG_SUFFISSO_NON_VALIDO })
  suffissoNumero?: string | null

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attivo?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
