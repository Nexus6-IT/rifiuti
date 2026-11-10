import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator'
import { FIR_SERIE_MAX } from '../../../infrastructure/pdf/definizione-fir'

/** Corpo di `POST /pdf/fir/serie`: da 1 a 100 FIR distinti, modello opzionale. */
export class FirSerieDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: FIR_SERIE_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FIR_SERIE_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  firIds!: string[]

  @ApiPropertyOptional({ description: 'Modello di stampa; assente = predefinito FIR/GENERALE' })
  @IsOptional()
  @IsUUID('all')
  modelloId?: string
}
