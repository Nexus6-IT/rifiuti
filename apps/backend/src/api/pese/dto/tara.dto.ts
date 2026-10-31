import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsNumber, IsOptional, IsUUID } from 'class-validator'

/**
 * Corpo di `PUT /pese/automezzi/:id/tara`: esattamente uno fra `taraKg` (tara DICHIARATA) e
 * `pesataId` (tara da PESATA). L'esclusività la controlla il controller.
 */
export class ImpostaTaraDto {
  @ApiPropertyOptional({ description: 'Tara dichiarata in kg (> 0, due decimali)' })
  @IsOptional()
  @IsNumber({}, { message: 'La tara deve essere un numero.' })
  taraKg?: number

  @ApiPropertyOptional({ description: 'Pesata da cui prendere la tara' })
  @IsOptional()
  @IsUUID('all', { message: 'Pesata non valida.' })
  pesataId?: string
}
