import { IsBoolean, IsOptional, IsString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

/** Corpo (facoltativo) di `POST rentri/fir/:id/firma-partenza` (FIR in viaggio, P3). */
export class FirmaPartenzaFirRentriDto {
  @ApiPropertyOptional({
    description:
      'Solo dopo che la richiesta e scaduta o rifiutata: chiede ESPLICITAMENTE una nuova richiesta di ' +
      'firma sul dispositivo. Senza, una sessione aperta viene ripresa (una sola richiesta sul telefono).',
  })
  @IsOptional()
  @IsBoolean()
  nuovaSessione?: boolean

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
