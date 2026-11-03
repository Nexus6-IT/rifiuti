/**
 * DTO delle azioni sul listino (4.2b, Task 23, D18, D19, R45). Il DTO controlla forma e tipi; le
 * regole sui valori (percentuali a cascata, tipo di provvigione) sono del servizio, che risponde
 * 400 con `details.errori` (R60). Provvigione e sconti ammettono `null` o vuoto (li svuotano).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator'

import { TIPI_PROVVIGIONE } from '../../../domain/listino/addebito'
import { IsTestoONumero } from './testo-o-numero'

/** Righe che si possono scegliere in una sola volta (un elenco ne ha al massimo qualche centinaio). */
export const MAX_RIGHE_DA_COPIARE = 1000

export class SostituisciDaDto {
  @ApiProperty({ description: 'Elenco da cui copiare le righe (altra azienda: 404)' })
  @IsUUID()
  daElencoId: string

  @ApiProperty({ description: 'Versione dell’elenco di arrivo letta dal client' })
  @IsInt()
  @Min(1)
  versione: number
}

export class AggiungiRigheDto {
  @ApiProperty({ type: [String], description: 'Righe da copiare nell’elenco' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RIGHE_DA_COPIARE)
  @IsUUID('all', { each: true })
  righeIds: string[]

  @ApiProperty()
  @IsInt()
  @Min(1)
  versione: number
}

export class ProvvigioniContrattoDto {
  @ApiPropertyOptional({ nullable: true, example: '10+5', description: 'Vuota o null: svuota' })
  @IsOptional()
  @IsTestoONumero()
  provvigione?: string | number | null

  @ApiPropertyOptional({ nullable: true, enum: TIPI_PROVVIGIONE })
  @IsOptional()
  @IsString()
  tipoProvvigione?: string | null
}

export class ScontiContrattoDto {
  @ApiProperty({ example: '10+5', description: 'Lo sconto da sostituire' })
  @IsTestoONumero()
  scontoAttuale: string | number

  @ApiProperty({ example: '12', description: 'Obbligatorio: lo sconto nuovo' })
  @IsTestoONumero()
  scontoNuovo: string | number
}
