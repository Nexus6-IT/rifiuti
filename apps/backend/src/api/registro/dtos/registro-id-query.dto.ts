import { IsOptional, IsUUID } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

/** Query `?registroId=` del progressivo iniziale (GET e PUT): senza, vale il registro predefinito (D3). */
export class RegistroIdQueryDto {
  @ApiPropertyOptional({ description: 'Registro (uuid). Senza, il registro predefinito.' })
  @IsUUID()
  @IsOptional()
  registroId?: string
}
