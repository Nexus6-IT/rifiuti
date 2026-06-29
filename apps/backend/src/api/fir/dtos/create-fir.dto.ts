/**
 * Create FIR DTO - Request validation
 */

import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  IsEnum,
  IsInt,
  IsArray,
  IsPositive,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { TipoTratta } from '../../../domain/fir/aggregates/fir.aggregate'

/**
 * Valori ammessi per lo stato fisico del rifiuto (norma tecnica, art. 193
 * D.Lgs 152/2006 e allegati DM 59/2023).
 */
export enum StatoFisicoRifiuto {
  SOLIDO = 'Solido',
  LIQUIDO = 'Liquido',
  FANGOSO = 'Fangoso',
  GASSOSO = 'Gassoso',
  POLVERE = 'Polvere',
  MISTO = 'Misto',
}

export class RifiutoDto {
  @ApiProperty({ example: '13 02 05*', description: 'Codice CER del rifiuto' })
  @IsString()
  @IsNotEmpty()
  cerCode: string

  @ApiProperty({ example: 120, description: 'Quantità dichiarata', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  quantita: number

  @ApiPropertyOptional({
    enum: UnitaMisura,
    default: UnitaMisura.KG,
    description: 'Unità di misura',
  })
  @IsEnum(UnitaMisura)
  @IsOptional()
  unitaMisura?: UnitaMisura

  /**
   * Campo 2 FIR (DM 59/2023): stato fisico del rifiuto.
   * Valori: Solido, Liquido, Fangoso, Gassoso, Polvere, Misto.
   */
  @ApiPropertyOptional({
    enum: StatoFisicoRifiuto,
    example: StatoFisicoRifiuto.LIQUIDO,
    description: 'Campo 2 FIR: stato fisico del rifiuto (DM 59/2023)',
  })
  @IsEnum(StatoFisicoRifiuto)
  @IsOptional()
  statoFisico?: string

  /**
   * Campo 2 FIR: caratteristiche di pericolo HP (Reg. UE 1357/2014, All. III
   * D.Lgs 152/2006). Multi-valore, separato da virgola es. "HP4,HP14".
   */
  @ApiPropertyOptional({
    example: 'HP4,HP14',
    description: 'Campo 2 FIR: caratteristiche di pericolo HP (Reg. UE 1357/2014), comma-separated',
  })
  @IsString()
  @IsOptional()
  caratteristichePericolo?: string

  /**
   * Campo 2 FIR (DM 59/2023): numero di colli dichiarato dal produttore.
   */
  @ApiPropertyOptional({
    example: 5,
    description: 'Campo 2 FIR: numero di colli',
    minimum: 1,
  })
  @IsInt()
  @IsPositive()
  @IsOptional()
  numeroColli?: number

  /**
   * Campo 3 FIR: codice operazione di recupero (R1–R13) o smaltimento
   * (D1–D15) effettuata dal destinatario (Allegati B e C D.Lgs 152/2006).
   */
  @ApiPropertyOptional({
    example: 'R13',
    description: 'Campo 3 FIR: codice operazione R/D (Allegati B e C D.Lgs 152/2006)',
  })
  @IsString()
  @IsOptional()
  codiceOperazione?: string
}

export class TrasportatoreAggiuntivoDto {
  @ApiProperty({
    example: 'trasportatore-uuid',
    description: 'ID del trasportatore (registro) per questa tratta intermodale',
  })
  @IsString()
  @IsNotEmpty()
  trasportatoreId: string

  @ApiProperty({
    enum: TipoTratta,
    example: TipoTratta.FERROVIARIA,
    description: 'Tipo di tratta (terrestre / ferroviaria / marittima)',
  })
  @IsEnum(TipoTratta)
  tipoTratta: TipoTratta

  @ApiProperty({
    example: 2,
    minimum: 1,
    description: 'Ordine della tratta nella sequenza del trasporto intermodale (1-based)',
  })
  @IsInt()
  @Min(1)
  ordine: number
}

export class CreateFIRDto {
  @ApiProperty({
    example: 'tenant-uuid-producer',
    description: 'ID tenant produttore/detentore',
  })
  @IsString()
  @IsNotEmpty()
  produttoreId: string

  @ApiProperty({ type: RifiutoDto, description: 'Dettagli rifiuto' })
  @ValidateNested()
  @Type(() => RifiutoDto)
  rifiuto: RifiutoDto

  @ApiProperty({
    example: 'tenant-uuid-transporter',
    description: 'ID tenant trasportatore',
  })
  @IsString()
  @IsNotEmpty()
  trasportatoreId: string

  @ApiProperty({
    example: 'tenant-uuid-destination',
    description: 'ID tenant destinatario',
  })
  @IsString()
  @IsNotEmpty()
  destinatarioId: string

  @ApiPropertyOptional({
    type: [TrasportatoreAggiuntivoDto],
    description:
      'Trasportatori aggiuntivi per trasporto intermodale (oltre al trasportatore ' +
      'principale). Ordinati per `ordine`. Omettere per un FIR mono-trasportatore.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrasportatoreAggiuntivoDto)
  trasportatoriAggiuntivi?: TrasportatoreAggiuntivoDto[]

  /**
   * Campo 17 FIR (DM 59/2023): annotazioni libere del produttore. Obbligatorio
   * per alcune tipologie di rifiuto (es. rifiuti sanitari, amianto).
   */
  @ApiPropertyOptional({
    example: 'Rifiuto proveniente da attività di manutenzione impianti.',
    description: 'Campo 17 FIR: annotazioni libere (DM 59/2023)',
  })
  @IsString()
  @IsOptional()
  annotazioni?: string
}
