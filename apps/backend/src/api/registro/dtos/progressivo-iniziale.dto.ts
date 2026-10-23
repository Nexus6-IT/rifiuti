import { IsInt, IsString, Length, Max, Min } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/** Corpo del PUT registro/progressivo-iniziale/:anno (decisione C-W-02). */
export class ImpostaProgressivoInizialeDto {
  @ApiProperty({
    description: "Numero che prenderà il primo movimento dell'anno registrato qui",
    example: 812,
    minimum: 1,
    maximum: 9999999,
  })
  @IsInt()
  @Min(1)
  @Max(9999999)
  primoProgressivo: number

  @ApiProperty({
    description: 'Perché si parte da questo numero (per esempio: migrazione da WinWaste)',
    example: 'Migrazione da WinWaste: ultimo movimento trasmesso il n. 811',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @Length(5, 500)
  motivo: string
}
