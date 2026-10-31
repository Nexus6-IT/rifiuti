/**
 * DTO delle rotte `testi-fatturazione` (4.1a, D25/D17). Il DTO controlla forma, tipi e i limiti
 * delle righe (1-16, al massimo 60 caratteri ciascuna); le altre regole sono del dominio.
 * Le righe vuote in coda sono ammesse qui: le toglie il dominio.
 *
 * `ModificaTestoFatturazioneDto` non usa `PartialType`: `null` e' 400.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator'

export class CreaTestoFatturazioneDto {
  @ApiProperty({ example: 'T1', description: '1-3 caratteri: lettere e cifre' })
  @IsString()
  codice: string

  @ApiProperty({ example: 'Dati per il pagamento' })
  @IsString()
  titolo: string

  @ApiProperty({ type: [String], description: 'Da 1 a 16 righe di al massimo 60 caratteri' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  righe: string[]
}

export class ModificaTestoFatturazioneDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  codice?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  titolo?: string

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  righe?: string[]

  @ApiPropertyOptional({ description: 'false = disattiva, true = riattiva' })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  attivo?: boolean

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
