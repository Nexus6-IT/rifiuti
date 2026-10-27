/**
 * Modifica FIR DTO - Request validation (piano D6)
 *
 * Tutti i campi di `CreateFIRDto` piu' `versione` (quella letta dal client), con
 * `rifiuto.unitaMisura` obbligatoria: in creazione ha il default `kg`, in modifica un'assenza
 * cambierebbe l'unita' di nascosto. `OmitType` (e non una ridichiarazione) perche' un
 * `@IsOptional` ereditato resterebbe attivo anche sul campo ridichiarato.
 */

import { IsEnum, IsInt, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, OmitType } from '@nestjs/swagger'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { CreateFIRDto, RifiutoDto } from './create-fir.dto'

export class RifiutoModificaDto extends OmitType(RifiutoDto, ['unitaMisura'] as const) {
  @ApiProperty({ enum: UnitaMisura, description: 'Unita di misura (obbligatoria in modifica)' })
  @IsEnum(UnitaMisura)
  unitaMisura: UnitaMisura
}

export class ModificaFIRDto extends OmitType(CreateFIRDto, ['rifiuto'] as const) {
  @ApiProperty({ type: RifiutoModificaDto, description: 'Dettagli rifiuto' })
  @ValidateNested()
  @Type(() => RifiutoModificaDto)
  rifiuto: RifiutoModificaDto

  @ApiProperty({
    example: 3,
    minimum: 1,
    description: 'Versione del FIR letta dal client: se non e piu quella corrente, 409',
  })
  @IsInt()
  @Min(1)
  versione: number
}
