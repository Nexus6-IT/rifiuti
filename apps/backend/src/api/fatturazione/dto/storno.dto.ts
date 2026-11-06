/**
 * Corpo di `POST /documenti-fattura/:id/storno` (4.4b1, §11). `dataDocumento` solo `AAAA-MM-GG`
 * (la data futura e quella anteriore al documento le controlla il servizio: 400 `DATA_FUTURA`,
 * 409 `DATA_ANTERIORE_ULTIMA_FATTURA`).
 */
import { ApiProperty } from '@nestjs/swagger'
import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { MOTIVO_MAX, trimTesto } from './annulla.dto'

export class StornoDto {
  @ApiProperty({ minLength: 1, maxLength: MOTIVO_MAX })
  @trimTesto()
  @IsString()
  @MinLength(1)
  @MaxLength(MOTIVO_MAX)
  motivo: string

  @ApiProperty({ example: '2026-05-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dataDocumento: data nel formato AAAA-MM-GG.' })
  dataDocumento: string

  @ApiProperty({ description: 'true: i legami tornano CONFERMATO e si possono rifatturare' })
  @IsBoolean()
  rifatturabile: boolean

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  versione: number
}
