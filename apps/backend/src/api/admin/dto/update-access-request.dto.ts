import { IsEnum, IsOptional, IsString, Length } from 'class-validator'
import { AccessRequestStatus } from '@prisma/client'

/**
 * UpdateAccessRequestDto — aggiornamento stato/nota di una richiesta di accesso.
 * Uso admin (SUPER_ADMIN) per tracciare la lavorazione del lead.
 */
export class UpdateAccessRequestDto {
  @IsEnum(AccessRequestStatus, {
    message: 'status ammette solo: PENDING, CONTACTED, CONVERTED, REJECTED',
  })
  status!: AccessRequestStatus

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  handledNote?: string
}
