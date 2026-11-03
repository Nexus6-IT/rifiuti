import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsUUID } from 'class-validator'
import { MaxDecimali } from '../../../core/validators/max-decimali'

/**
 * Corpo di `PUT /pese/automezzi/:id/tara`: esattamente uno fra `taraKg` (tara DICHIARATA) e
 * `pesataId` (tara da PESATA). L'esclusività la controlla il controller.
 */
export class ImpostaTaraDto {
  @ApiPropertyOptional({ description: 'Tara dichiarata in kg (> 0, due decimali)' })
  @IsOptional()
  @MaxDecimali(2, 'La tara')
  taraKg?: number

  @ApiPropertyOptional({ description: 'Pesata da cui prendere la tara' })
  @IsOptional()
  @IsUUID('all', { message: 'Pesata non valida.' })
  pesataId?: string
}
