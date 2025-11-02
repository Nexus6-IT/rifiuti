/**
 * Dev Login DTO
 * Used only in development to bypass SPID authentication
 */

import { IsEmail, IsOptional, IsString } from 'class-validator'

export class DevLoginDto {
  @IsEmail()
  email: string

  @IsString()
  @IsOptional()
  fiscalCode?: string

  @IsString()
  @IsOptional()
  firstName?: string

  @IsString()
  @IsOptional()
  lastName?: string
}
