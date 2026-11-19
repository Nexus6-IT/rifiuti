import { IsOptional, IsString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

/** Corpo (facoltativo) di `POST rentri/fir/:id/rollback-firma` e `POST rentri/fir/:id/reset`. */
export class RollbackOResetFirRentriDto {
  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
