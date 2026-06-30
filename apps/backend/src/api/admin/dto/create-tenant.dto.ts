import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Length,
  Matches,
  IsEnum,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator'
import { SubscriptionTier, SubscriptionStatus } from '@prisma/client'
import { FEATURE_KEYS } from '../../../application/admin/feature-catalog'

/**
 * CreateTenantDto
 * Payload per la creazione di un tenant (solo SUPER_ADMIN).
 *
 * Campi obbligatori: partitaIva, ragioneSociale, address, city, province, postalCode.
 * La partitaIva deve essere univoca (vincolo applicato a livello DB e nel service).
 */
export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{11}$/, { message: 'partitaIva deve contenere 11 cifre' })
  partitaIva!: string

  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  ragioneSociale!: string

  @IsOptional()
  @IsString()
  @Length(11, 16)
  codiceFiscale?: string

  @IsOptional()
  @IsString()
  @Length(1, 255)
  pec?: string

  @IsOptional()
  @IsString()
  @Length(1, 20)
  telefono?: string

  @IsOptional()
  @IsString()
  @Length(1, 10)
  atecoCode?: string

  @IsOptional()
  @IsString()
  @Length(1, 9)
  reaNumber?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  numeroAddetti?: number

  @IsOptional()
  @IsString()
  @Length(1, 25)
  legaleRappresentanteNome?: string

  @IsOptional()
  @IsString()
  @Length(1, 25)
  legaleRappresentanteCognome?: string

  // Address (obbligatorio)
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  address!: string

  @IsOptional()
  @IsString()
  @Length(1, 10)
  civico?: string

  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  city!: string

  @IsString()
  @IsNotEmpty()
  @Length(2, 2, { message: 'province deve essere la sigla di 2 lettere' })
  province!: string

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{5}$/, { message: 'postalCode deve contenere 5 cifre' })
  postalCode!: string

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string

  // Subscription (opzionali: default applicati dal service / schema)
  @IsOptional()
  @IsEnum(SubscriptionTier)
  subscriptionTier?: SubscriptionTier

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  subscriptionStatus?: SubscriptionStatus

  @IsOptional()
  @IsInt()
  @Min(0)
  firLimitPerMonth?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  userLimitTotal?: number

  /**
   * Override esplicito delle feature abilitate (array di chiavi del catalogo).
   * Se omesso, il service applica i default del piano (PLAN_FEATURES[tier]).
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(FEATURE_KEYS as unknown as string[], {
    each: true,
    message: `featureFlags ammette solo: ${FEATURE_KEYS.join(', ')}`,
  })
  featureFlags?: string[]

  /**
   * Admin proprietario dell'azienda (chi potrà gestirla/switchare).
   * Usato SOLO dal SUPER_ADMIN per creare un'azienda per conto di un admin.
   * Per gli ADMIN in self-service viene ignorato (forzato a se stessi).
   */
  @IsOptional()
  @IsUUID()
  ownerUserId?: string
}
