/** Query di `GET /scostamenti-fattura` (4.4b1, §11). */
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsUUID } from 'class-validator'
import { PaginaQueryDto } from './lista-elaborazioni.dto'

export class ListaScostamentiQueryDto extends PaginaQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string
}
