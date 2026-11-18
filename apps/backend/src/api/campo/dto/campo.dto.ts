import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, Matches } from 'class-validator'

export class GiroQueryDto {
  @ApiProperty({ example: '2026-11-19' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La data del giro non è valida.' })
  data!: string
}

export class ElencoAutistiQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'Filtro non valido.' })
  attivi?: 'true' | 'false'
}
