/**
 * DTO di `GET /numerazioni-fattura` e `PUT /numerazioni-fattura/:registroIvaId/:anno` (4.4a, §4.6).
 * `numeroPartenza` e' un intero da 0 a 99999999; `dataPartenza` una data `AAAA-MM-GG` o `null`
 * (il frontend manda `null` quando l'utente svuota il campo).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator'

export class ElencoNumerazioniQueryDto {
  @ApiPropertyOptional({ example: 2026, description: "Anno; omesso: l'anno corrente" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anno?: number
}

export class ParametriNumerazioneDto {
  @IsUUID()
  registroIvaId: string

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anno: number
}

export class ImpostaPartenzaDto {
  @ApiProperty({ example: 120, minimum: 0, maximum: 99999999 })
  @IsInt()
  @Min(0)
  @Max(99_999_999)
  numeroPartenza: number

  @ApiProperty({ type: String, nullable: true, example: '2026-03-31' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dataPartenza: data nel formato AAAA-MM-GG' })
  @IsOptional()
  dataPartenza: string | null

  @ApiProperty({ example: 0, description: '0 se la numerazione non esiste ancora' })
  @IsInt()
  @Min(0)
  versione: number
}
