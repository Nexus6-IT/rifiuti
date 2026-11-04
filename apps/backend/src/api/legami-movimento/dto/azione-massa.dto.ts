/** DTO di `POST /legami-movimento/azioni` (4.3b, Task 22): conferma o esclusione in massa, tetto 500. */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator'
import { Nidificato } from './valori-legame.validators'

export class ElementoAzioneMassaDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Il legame non è valido.' })
  legameId: string

  @ApiProperty({ example: 1 })
  @IsInt({ message: 'La versione deve essere un numero intero.' })
  @Min(1, { message: 'La versione parte da 1.' })
  versione: number
}

export class AzioneMassaDto {
  @ApiProperty({ enum: ['CONFERMA', 'ESCLUDI'] })
  @IsIn(['CONFERMA', 'ESCLUDI'], { message: 'L’azione deve essere CONFERMA o ESCLUDI.' })
  azione: 'CONFERMA' | 'ESCLUDI'

  @ApiPropertyOptional({ type: [ElementoAzioneMassaDto], description: 'Legami esistenti' })
  @IsOptional()
  @IsArray({ message: 'Gli elementi devono essere una lista.' })
  @ArrayMaxSize(500, { message: 'Gli elementi sono al massimo 500.' })
  @Nidificato(ElementoAzioneMassaDto, { each: true, elemento: 'Elemento' })
  @Type(() => ElementoAzioneMassaDto)
  elementi?: ElementoAzioneMassaDto[]

  @ApiPropertyOptional({ type: [String], description: 'Movimenti ancora senza legame' })
  @IsOptional()
  @IsArray({ message: 'I movimenti devono essere una lista.' })
  @ArrayMaxSize(500, { message: 'I movimenti sono al massimo 500.' })
  @IsUUID('all', { each: true, message: 'Un movimento non è valido.' })
  movimentoIds?: string[]

  @ApiPropertyOptional({ description: 'Obbligatorio con ESCLUDI' })
  @IsOptional()
  @IsString({ message: 'Il motivo deve essere un testo.' })
  @MaxLength(1000, { message: 'Il motivo è troppo lungo.' })
  motivo?: string
}
