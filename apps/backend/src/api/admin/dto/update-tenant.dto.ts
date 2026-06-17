import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Length,
  Matches,
  IsEnum,
  IsArray,
  IsIn,
} from 'class-validator';
import { SubscriptionTier, SubscriptionStatus } from '@prisma/client';
import { FEATURE_KEYS } from '../../../application/admin/feature-catalog';

/**
 * UpdateTenantDto
 * Aggiornamento parziale di un tenant (solo SUPER_ADMIN).
 * Tutti i campi sono opzionali; la partitaIva NON è modificabile da qui
 * (identificativo univoco — gestione dedicata se mai necessaria).
 */
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  ragioneSociale?: string;

  @IsOptional()
  @IsString()
  @Length(11, 16)
  codiceFiscale?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  pec?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  telefono?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  atecoCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 9)
  reaNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  numeroAddetti?: number;

  @IsOptional()
  @IsString()
  @Length(1, 25)
  legaleRappresentanteNome?: string;

  @IsOptional()
  @IsString()
  @Length(1, 25)
  legaleRappresentanteCognome?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  civico?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2, { message: 'province deve essere la sigla di 2 lettere' })
  province?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{5}$/, { message: 'postalCode deve contenere 5 cifre' })
  postalCode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsEnum(SubscriptionTier)
  subscriptionTier?: SubscriptionTier;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  subscriptionStatus?: SubscriptionStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  firLimitPerMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  userLimitTotal?: number;

  /**
   * Override esplicito delle feature abilitate (array di chiavi del catalogo).
   * Ogni elemento deve appartenere a FEATURE_KEYS. Se omesso, le feature
   * restano invariate; per tornare a derivarle dal piano impostarlo a `null`
   * (gestito nel service).
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(FEATURE_KEYS as unknown as string[], {
    each: true,
    message: `featureFlags ammette solo: ${FEATURE_KEYS.join(', ')}`,
  })
  featureFlags?: string[];
}
