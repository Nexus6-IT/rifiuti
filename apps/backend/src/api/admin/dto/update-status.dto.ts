/**
 * DTO per abilitare/disabilitare un utente.
 */

import { IsBoolean } from 'class-validator'

export class UpdateStatusDto {
  @IsBoolean()
  enabled: boolean
}
