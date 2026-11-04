/**
 * DTO di `POST /legami-movimento/proposta` (4.3b, Task 22, task-15 del rapporto): i dati di un
 * movimento ancora da registrare, con i nomi del registro (`causale` = CODICE, `type`, `cerCode`,
 * `movementDate`, `unit`, `quantity` stringa col punto), piu' le scelte dell'utente.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'
import { Nidificato } from './valori-legame.validators'

export class RigaSceltaDto {
  @ApiProperty()
  @IsUUID('all', { message: 'La riga non è valida.' })
  rigaAddebitoId: string
}

export class ScelteDto {
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

  @ApiPropertyOptional({ type: [RigaSceltaDto], description: 'Selezione completa delle righe' })
  @IsOptional()
  @IsArray({ message: 'Le righe devono essere una lista.' })
  @ArrayMaxSize(100, { message: 'Le righe sono al massimo 100.' })
  @Nidificato(RigaSceltaDto, { each: true })
  @Type(() => RigaSceltaDto)
  righe?: RigaSceltaDto[]
}

export class PropostaLegameDto {
  @ApiProperty({ example: 'INGRESSO_ESTERNO', description: 'Codice della causale' })
  @IsString({ message: 'La causale deve essere un testo.' })
  @IsNotEmpty({ message: 'Indica la causale.' })
  @MaxLength(60, { message: 'La causale è troppo lunga.' })
  causale: string

  @ApiPropertyOptional({ nullable: true, description: 'Versione aziendale esatta della causale' })
  @IsOptional()
  @IsUUID('all', { message: 'La causale aziendale non è valida.' })
  causaleAziendaId?: string | null

  @ApiProperty({ enum: ['CARICO', 'SCARICO'] })
  @IsIn(['CARICO', 'SCARICO'], { message: 'Il tipo deve essere CARICO o SCARICO.' })
  type: 'CARICO' | 'SCARICO'

  @ApiProperty({ example: '20 03 01' })
  @IsString({ message: 'Il codice CER deve essere un testo.' })
  @IsNotEmpty({ message: 'Indica il codice CER.' })
  @MaxLength(10, { message: 'Il codice CER è troppo lungo.' })
  cerCode: string

  @ApiProperty({ example: '2026-03-01' })
  @IsDateString({}, { message: 'La data del movimento non è valida.' })
  movementDate: string

  @ApiProperty({ example: 'KG' })
  @IsString({ message: 'L’unità di misura deve essere un testo.' })
  @IsNotEmpty({ message: 'Indica l’unità di misura.' })
  @MaxLength(10, { message: 'L’unità di misura è troppo lunga.' })
  unit: string

  @ApiProperty({ example: '100.5', description: 'Stringa col punto, maggiore o uguale a zero' })
  @Matches(/^\d{1,10}(\.\d{1,3})?$/, {
    message: 'La quantità deve essere un numero col punto decimale (al massimo 3 decimali).',
  })
  quantity: string

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('all', { message: 'Il FIR non è valido.' })
  firId?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Solo controllo di coerenza con il FIR' })
  @IsOptional()
  @IsUUID('all', { message: 'La sede del produttore non è valida.' })
  producerSedeId?: string | null

  @ApiPropertyOptional({ type: ScelteDto })
  @IsOptional()
  @Nidificato(ScelteDto, { elemento: 'Scelte' })
  @Type(() => ScelteDto)
  scelte?: ScelteDto
}
