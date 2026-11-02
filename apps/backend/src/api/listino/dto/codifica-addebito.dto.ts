/**
 * DTO delle rotte `codifiche-addebito` (4.2a, D4/R2/R24). Il `genere` si sceglie alla creazione
 * e non cambia: il DTO di modifica non lo contiene (con `forbidNonWhitelisted` e' 400).
 *
 * Alla creazione il `codice` e' `null` (modo normale: lo chiede l'utente) o assente (creazione
 * rapida in linea): in entrambi i casi il servizio assegna il primo codice libero. In modifica
 * `null` e' 400 e la stringa vuota arriva al dominio, che risponde col messaggio del codice.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator'

export const GENERI_CODIFICA_ADDEBITO = [
  'GRUPPO',
  'CATEGORIA',
  'CATEGORIA_STATISTICA_1',
  'CATEGORIA_STATISTICA_2',
  'CENTRO_RICAVO',
] as const
export type GenereCodificaAddebitoDto = (typeof GENERI_CODIFICA_ADDEBITO)[number]

/** Query di `GET codifiche-addebito`: il genere e' obbligatorio. */
export class ElencoCodificheAddebitoQueryDto {
  @ApiProperty({ enum: GENERI_CODIFICA_ADDEBITO })
  @IsIn(GENERI_CODIFICA_ADDEBITO)
  genere: GenereCodificaAddebitoDto

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  incluseDisattivate?: string
}

/** Query di `GET codifiche-addebito/prossimo-codice`. */
export class ProssimoCodiceAddebitoQueryDto {
  @ApiProperty({ enum: GENERI_CODIFICA_ADDEBITO })
  @IsIn(GENERI_CODIFICA_ADDEBITO)
  genere: GenereCodificaAddebitoDto
}

export class CreaCodificaAddebitoDto {
  @ApiProperty({ enum: GENERI_CODIFICA_ADDEBITO })
  @IsIn(GENERI_CODIFICA_ADDEBITO)
  genere: GenereCodificaAddebitoDto

  @ApiProperty({ example: 'Servizi di raccolta' })
  @IsString()
  descrizione: string

  @ApiPropertyOptional({
    example: '007',
    description: 'Da 1 a 3 cifre; null o assente = primo codice libero del genere',
  })
  @IsOptional()
  @IsString()
  codice?: string | null
}

export class ModificaCodificaAddebitoDto {
  @ApiPropertyOptional({ description: 'Da 1 a 3 cifre' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  codice?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  descrizione?: string

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attiva?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
