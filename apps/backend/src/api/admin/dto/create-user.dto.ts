/**
 * DTO per la creazione di un utente (gestione utenti in-app).
 *
 * ADMIN puo' creare solo nel proprio tenant (il `tenantId` viene ignorato/forzato
 * dal service); SUPER_ADMIN puo' specificare un `tenantId` qualsiasi.
 */

import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsEnum,
  IsUUID,
  IsInt,
  Min,
  Length,
  MinLength,
} from 'class-validator';

export enum UserRoleDto {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @Length(16, 16, { message: 'fiscalCode deve essere di 16 caratteri' })
  fiscalCode: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsEnum(UserRoleDto)
  role: UserRoleDto;

  /**
   * Obbligatorio per SUPER_ADMIN (sceglie il tenant di destinazione).
   * Per ADMIN viene ignorato: l'utente e' creato nel proprio tenant.
   */
  @IsUUID()
  @IsOptional()
  tenantId?: string;

  /**
   * Password temporanea iniziale. Se presente viene impostata su Keycloak con
   * `temporary: true` (l'utente la cambia al primo login).
   */
  @IsString()
  @IsOptional()
  @MinLength(10, { message: 'La password temporanea deve avere almeno 10 caratteri' })
  tempPassword?: string;

  /**
   * Quota di aziende creabili in autonomia dall'utente (self-service).
   * Applicata SOLO se chi crea è SUPER_ADMIN; per gli ADMIN viene ignorata e
   * resta il default di schema (1).
   */
  @IsInt()
  @Min(0)
  @IsOptional()
  companyLimit?: number;
}
