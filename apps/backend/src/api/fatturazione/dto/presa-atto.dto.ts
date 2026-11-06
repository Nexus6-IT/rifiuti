/** Corpo di `POST /legami-movimento/:id/presa-atto-scostamento` (4.4b1, §11, Q31). */
import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator'
import { trimTesto } from './annulla.dto'

export const NOTA_MAX = 200

export class LegameParamDto {
  @IsUUID()
  id: string
}

export class PresaAttoDto {
  @ApiProperty({ minLength: 1, maxLength: NOTA_MAX })
  @trimTesto()
  @IsString()
  @MinLength(1)
  @MaxLength(NOTA_MAX)
  nota: string

  @ApiProperty({ description: 'Versione del legame (`versioneLegame` della riga)', minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  versione: number
}
