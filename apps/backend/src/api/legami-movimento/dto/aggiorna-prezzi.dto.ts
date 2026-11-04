/**
 * DTO di `POST /legami-movimento/aggiorna-prezzi` (4.3b, Task 22): senza `firma` il server
 * calcola solo l'anteprima, con la firma dell'anteprima vista applica. Le date e l'esistenza
 * di contratto o elenco le controlla il servizio (400 `PERIMETRO_NON_VALIDO`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator'

export class PerimetroAggiornamentoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Il contratto non è valido.' })
  contrattoId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'L’elenco non è valido.' })
  elencoId?: string

  @ApiPropertyOptional({ example: '2026-01-01', description: 'AAAA-MM-GG, incluso' })
  @IsOptional()
  @IsString({ message: 'La data iniziale deve essere un testo AAAA-MM-GG.' })
  @MaxLength(10, { message: 'La data iniziale non è valida.' })
  dal?: string

  @ApiPropertyOptional({ example: '2026-03-31', description: 'AAAA-MM-GG, incluso' })
  @IsOptional()
  @IsString({ message: 'La data finale deve essere un testo AAAA-MM-GG.' })
  @MaxLength(10, { message: 'La data finale non è valida.' })
  al?: string
}

export class AggiornaPrezziDto {
  @ApiProperty({ type: PerimetroAggiornamentoDto })
  @IsObject({ message: 'Indica il perimetro da aggiornare.' })
  @ValidateNested()
  @Type(() => PerimetroAggiornamentoDto)
  perimetro: PerimetroAggiornamentoDto

  @ApiPropertyOptional({ description: 'Impronta dell’anteprima vista; assente = anteprima' })
  @IsOptional()
  @IsString({ message: 'La firma deve essere un testo.' })
  @MaxLength(200, { message: 'La firma non è valida.' })
  firma?: string
}
