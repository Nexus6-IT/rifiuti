import { IsDateString, IsInt, IsOptional, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger'
import { CreateContractDto } from './create-contract.dto'

/**
 * Corpo di `PATCH /contracts/:id` (Fase 4 pezzo 0, D4): modifica parziale. Un campo assente non
 * cambia; `null` svuota i campi facoltativi (descrizione, prezzo base, data di fine, durata) e
 * sugli obbligatori e' un 400 "<campo> è obbligatorio" dal servizio. `PartialType` rende
 * opzionali (e nullable per `IsOptional`) tutti i campi del DTO di creazione.
 *
 * `startDate` e `endDate` sono ridichiarati per dire nel tipo che accettano `null`. `pricingConfig` e' escluso con `OmitType`: e' un Json scritto e mai letto, non modificabile da
 * questa API (D2); con `forbidNonWhitelisted` inviarlo e' un 400. `status` non e' un campo: si
 * cambia solo con `PATCH :id/status`.
 */
export class ModificaContrattoDto extends PartialType(
  OmitType(CreateContractDto, ['pricingConfig', 'startDate', 'endDate'] as const)
) {
  // Semantica esplicita (D4): `IsOptional` lascia passare anche `null`. Su `startDate` il servizio
  // lo respinge ("Data di inizio è obbligatoria."), su `endDate` svuota il campo.
  @ApiPropertyOptional({ example: '2026-01-01', nullable: false })
  @IsDateString()
  @IsOptional()
  startDate?: string | null

  @ApiPropertyOptional({ example: '2026-12-31', nullable: true })
  @IsDateString()
  @IsOptional()
  endDate?: string | null

  @ApiProperty({ description: 'Versione del contratto letta dal client (lock ottimistico)' })
  @IsInt()
  @Min(1)
  versione: number
}
