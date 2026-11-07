/**
 * Corpi di `POST /documenti-fattura/:id/xml` e `POST /documenti-fattura/:id/emesso` (4.4b2, §11).
 * `confermaEmissione` e` obbligatoria e non ha un predefinito: il servizio non la inventa mai.
 */
import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsInt, Max, Min } from 'class-validator'

export class ConfermaEmissioneDto {
  @ApiProperty({ description: 'true = il documento non ancora emesso diventa emesso' })
  @IsBoolean()
  confermaEmissione: boolean
}

export class SegnaEmessoDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  versione: number
}
