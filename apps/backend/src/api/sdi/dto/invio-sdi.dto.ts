/**
 * Corpo di `POST /documenti-fattura/invio-sdi` (4.5b). Il DTO controlla forma e tipi; il tetto di 500
 * documenti e la validita' degli id sono del servizio (400 `TROPPI_DOCUMENTI`, `IDENTIFICATIVO_NON_VALIDO`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

export class InvioSdiDto {
  @ApiProperty({ type: [String], description: 'Documenti da inviare (al massimo 500)' })
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  ids: string[]

  @ApiPropertyOptional({
    description:
      'true = il documento e` gia` emesso (XML scaricato o segnato come emesso): l`utente accetta lo scarto per duplicato dello SDI',
  })
  @IsOptional()
  @IsBoolean()
  confermaGiaEmesso?: boolean
}
