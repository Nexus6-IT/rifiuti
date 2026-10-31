/**
 * DTO delle rotte `condizioni-pagamento` (4.1a, D6/D17). Il DTO controlla forma e tipi; le regole
 * sui valori (codice, crescenza delle rate, ...) sono del dominio e rispondono con l'elenco dei
 * messaggi in italiano.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator'
import { MODALITA_PAGAMENTO } from '../../../domain/clienti/condizione-pagamento'

export class CreaCondizionePagamentoDto {
  @ApiProperty({ example: 'BB30', description: '1-10 caratteri: lettere, cifre, . - _' })
  @IsString()
  codice: string

  @ApiProperty({ example: 'Bonifico 30 giorni fine mese' })
  @IsString()
  descrizione: string

  @ApiProperty({ enum: MODALITA_PAGAMENTO })
  @IsIn(MODALITA_PAGAMENTO)
  modalita: (typeof MODALITA_PAGAMENTO)[number]

  @ApiProperty({
    type: [Number],
    example: [30, 60],
    description: 'Giorni di ciascuna rata (1-8), crescenti; 0 = a vista (rata unica)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  giorniRate: number[]

  @ApiProperty({ example: true })
  @IsBoolean()
  fineMese: boolean
}

/**
 * Modifica parziale. Non usa `PartialType`: questo aggiunge `IsOptional`, che lascia passare anche
 * `null` (e `fineMese: null` azzererebbe il flag in silenzio). Qui un campo o manca, o ha il tipo
 * giusto: `null` e' 400.
 */
export class ModificaCondizionePagamentoDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  codice?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  descrizione?: string

  @ApiPropertyOptional({ enum: MODALITA_PAGAMENTO })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(MODALITA_PAGAMENTO)
  modalita?: (typeof MODALITA_PAGAMENTO)[number]

  @ApiPropertyOptional({ type: [Number] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  giorniRate?: number[]

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  fineMese?: boolean

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attiva?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
