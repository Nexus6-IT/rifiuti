/**
 * Refresh Token DTO
 * Request body for token refresh endpoint
 */

import { IsString, IsNotEmpty } from 'class-validator'

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string
}
