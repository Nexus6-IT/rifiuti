/**
 * DTO delle modifiche al legame (4.3b, Task 22, spec §8.1): `PUT :id` (con `versione`), `modifiche`
 * della conferma. Quantita', prezzo e sconto sono stringhe col punto; `null` ammesso solo dove il
 * servizio lo legge (quantita' `null` = torna alla derivata, sconto `null` = nessuno sconto).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator'
import { Nidificato, PrezzoLegame, QuantitaLegame, ScontoLegame } from './valori-legame.validators'

export class RigaModificaLegameDto {
  @ApiProperty({ description: 'Riga di listino (del legame, o da aggiungere dall’elenco)' })
  @IsUUID('all', { message: 'La riga non è valida.' })
  rigaAddebitoId: string

  @ApiPropertyOptional({
    nullable: true,
    example: '12.5',
    description: 'Maggiore di zero, al massimo 3 decimali; null = quantità del movimento',
  })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @QuantitaLegame()
  quantita?: string | null

  @ApiPropertyOptional({ example: '3.5', description: 'Zero o più, al massimo 6 decimali' })
  @ValidateIf((_, v) => v !== undefined)
  @PrezzoLegame()
  prezzo?: string

  @ApiPropertyOptional({ nullable: true, example: '10+5', description: 'Formula a cascata' })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @ScontoLegame()
  sconto?: string | null

  @ApiPropertyOptional({ description: 'Toglie la riga dal legame' })
  @IsOptional()
  @IsBoolean({ message: 'Il campo «rimuovi» deve essere vero o falso.' })
  rimuovi?: boolean
}

export class ModificheLegameDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Il cliente non è valido.' })
  clienteId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Il contratto non è valido.' })
  contrattoId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'L’elenco non è valido.' })
  elencoId?: string

  @ApiPropertyOptional({ type: [RigaModificaLegameDto] })
  @IsOptional()
  @IsArray({ message: 'Le righe devono essere una lista.' })
  @ArrayMaxSize(100, { message: 'Le righe sono al massimo 100.' })
  @Nidificato(RigaModificaLegameDto, { each: true })
  @Type(() => RigaModificaLegameDto)
  righe?: RigaModificaLegameDto[]
}

export class ModificaLegameDto extends ModificheLegameDto {
  @ApiProperty({ example: 1, description: 'Versione vista dall’utente (lock ottimistico)' })
  @IsInt({ message: 'La versione deve essere un numero intero.' })
  @Min(1, { message: 'La versione parte da 1.' })
  versione: number
}
