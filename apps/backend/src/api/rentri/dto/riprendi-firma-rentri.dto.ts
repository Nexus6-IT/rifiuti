import { IsBoolean, IsOptional, IsString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

/** Corpo di `POST rentri/fir/:id/firme/:sessioneId/riprendi` (FIR in viaggio, P1). */
export class RiprendiFirmaRentriDto {
  @ApiPropertyOptional({
    description:
      'Solo dopo che la richiesta e scaduta o rifiutata: chiede ESPLICITAMENTE una nuova richiesta di ' +
      'firma sul dispositivo. Senza, una sessione chiusa restituisce il suo esito e basta.',
  })
  @IsOptional()
  @IsBoolean()
  nuovaSessione?: boolean

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
