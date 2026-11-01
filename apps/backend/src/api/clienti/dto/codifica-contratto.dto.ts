/**
 * DTO delle rotte `codifiche-contratto` (4.1a, D26/D17). Il `genere` si sceglie alla creazione e
 * non cambia: il DTO di modifica non lo contiene (con `forbidNonWhitelisted` e' 400).
 * Il `codice` alla creazione e' facoltativo: omesso = primo codice numerico libero del genere.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator'

export const GENERI_CODIFICA = ['CATEGORIA', 'TIPO', 'MOTIVO_ANNULLO'] as const
export type GenereCodificaDto = (typeof GENERI_CODIFICA)[number]

/** Query di `GET codifiche-contratto`: il genere e' obbligatorio. */
export class ElencoCodificheQueryDto {
  @ApiProperty({ enum: GENERI_CODIFICA })
  @IsIn(GENERI_CODIFICA)
  genere: GenereCodificaDto

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  incluseDisattivate?: string
}

/** Query di `GET codifiche-contratto/prossimo-codice`. */
export class ProssimoCodiceQueryDto {
  @ApiProperty({ enum: GENERI_CODIFICA })
  @IsIn(GENERI_CODIFICA)
  genere: GenereCodificaDto
}

export class CreaCodificaContrattoDto {
  @ApiProperty({ enum: GENERI_CODIFICA })
  @IsIn(GENERI_CODIFICA)
  genere: GenereCodificaDto

  @ApiProperty({ example: 'Rifiuti urbani' })
  @IsString()
  descrizione: string

  @ApiPropertyOptional({
    example: '001',
    description: '1-3 caratteri alfanumerici; omesso = primo codice numerico libero del genere',
  })
  @IsOptional()
  @IsString()
  codice?: string
}

export class ModificaCodificaContrattoDto {
  @ApiPropertyOptional()
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
