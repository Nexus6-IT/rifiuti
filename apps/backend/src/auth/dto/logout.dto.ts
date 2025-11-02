/**
 * Logout DTO
 * Request body for logout endpoint
 */

import { IsString, IsNotEmpty } from 'class-validator'

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string
}
