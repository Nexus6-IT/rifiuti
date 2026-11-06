/** Corpo di `POST /documenti-fattura/:id/annulla` (4.4b1, §11): motivo da 1 a 200 caratteri dopo trim. */
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

export const MOTIVO_MAX = 200

/** Toglie gli spazi ai bordi prima della validazione (un motivo di soli spazi vale come vuoto). */
export const trimTesto = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))

export class AnnullaDto {
  @ApiProperty({ minLength: 1, maxLength: MOTIVO_MAX })
  @trimTesto()
  @IsString()
  @MinLength(1)
  @MaxLength(MOTIVO_MAX)
  motivo: string

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  versione: number
}
