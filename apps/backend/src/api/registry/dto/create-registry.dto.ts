/**
 * Registry DTOs
 * Data Transfer Objects for Registry API
 */

import { IsString, IsNotEmpty, IsOptional, IsEmail, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class IndirizzoDto {
  @IsString()
  @IsNotEmpty()
  via: string

  @IsString()
  @IsNotEmpty()
  civico: string

  @IsString()
  @IsNotEmpty()
  cap: string

  @IsString()
  @IsNotEmpty()
  comune: string

  @IsString()
  @IsNotEmpty()
  provincia: string

  @IsString()
  @IsOptional()
  nazione?: string
}

export class CreateProduttoreDto {
  @IsString()
  @IsNotEmpty()
  ragioneSociale: string

  @IsString()
  @IsNotEmpty()
  partitaIVA: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  sedeLegale: IndirizzoDto

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string
}

export class CreateTrasportatoreDto {
  @IsString()
  @IsNotEmpty()
  ragioneSociale: string

  @IsString()
  @IsNotEmpty()
  partitaIVA: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  sedeLegale: IndirizzoDto

  @IsString()
  @IsNotEmpty()
  numeroIscrizione: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string
}

export class CreateDestinatarioDto {
  @IsString()
  @IsNotEmpty()
  ragioneSociale: string

  @IsString()
  @IsNotEmpty()
  partitaIVA: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  sede: IndirizzoDto

  @IsString()
  @IsNotEmpty()
  numeroAutorizzazione: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string
}

// Update DTOs
// Note: partitaIVA is readonly and cannot be updated
export class UpdateProduttoreDto {
  @IsString()
  @IsOptional()
  ragioneSociale?: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  @IsOptional()
  sedeLegale?: IndirizzoDto

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string
}

export class UpdateTrasportatoreDto {
  @IsString()
  @IsOptional()
  ragioneSociale?: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  @IsOptional()
  sedeLegale?: IndirizzoDto

  @IsString()
  @IsOptional()
  numeroIscrizione?: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string
}

export class UpdateDestinatarioDto {
  @IsString()
  @IsOptional()
  ragioneSociale?: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  @IsOptional()
  sede?: IndirizzoDto

  @IsString()
  @IsOptional()
  numeroAutorizzazione?: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string
}
