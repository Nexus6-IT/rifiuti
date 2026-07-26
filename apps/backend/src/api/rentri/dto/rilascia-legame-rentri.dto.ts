import { IsOptional, IsString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

/** Corpo (facoltativo) di `POST /rentri/fir/:id/rilascia-legame-rentri`. */
export class RilasciaLegameRentriDto {
  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
