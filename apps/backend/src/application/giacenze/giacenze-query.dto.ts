import { IsOptional, IsUUID } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

/** Query di `GET /giacenze` e degli alert: filtro facoltativo per registro. */
export class GiacenzeQueryDto {
  @ApiPropertyOptional({
    description:
      "Solo i movimenti di questo registro. Senza, si sommano tutti i registri dell'azienda.",
  })
  @IsUUID()
  @IsOptional()
  registroId?: string
}
