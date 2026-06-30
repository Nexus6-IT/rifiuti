/**
 * DTO per l'aggiornamento del ruolo applicativo di un utente.
 */

import { IsEnum } from 'class-validator'
import { UserRoleDto } from './create-user.dto'

export class UpdateRoleDto {
  @IsEnum(UserRoleDto)
  role: UserRoleDto
}
