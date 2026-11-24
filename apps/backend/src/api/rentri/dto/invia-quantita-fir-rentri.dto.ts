import { IsBoolean, IsEnum, IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { MaxDecimali } from '../../../core/validators/max-decimali'

/**
 * Corpo di `POST rentri/fir/:id/quantita`: quantita' del rifiuto e colli (o rinfusa). Stessi limiti della
 * quantita' del FIR (`RifiutoDto`: 2 decimali, almeno 0,01): la copia locale segue l'ente solo dopo
 * l'esito positivo, e deve poterla contenere.
 */
export class InviaQuantitaFirRentriDto {
  @ApiProperty({ example: 120, minimum: 0.01 })
  @MaxDecimali(2, 'La quantità')
  @Min(0.01, { message: 'La quantità deve essere almeno 0,01.' })
  quantita: number

  @ApiProperty({ enum: UnitaMisura, example: UnitaMisura.KG })
  @IsEnum(UnitaMisura)
  unitaMisura: UnitaMisura

  @ApiPropertyOptional({
    example: 5,
    description: 'Numero di colli: obbligatorio se il rifiuto non e alla rinfusa',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  numeroColli?: number

  @ApiPropertyOptional({ description: 'Il rifiuto non e partizionato in colli' })
  @IsOptional()
  @IsBoolean()
  rinfusa?: boolean

  @ApiPropertyOptional({ description: 'Quantita verificata in partenza' })
  @IsOptional()
  @IsBoolean()
  verificatoInPartenza?: boolean

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
