/**
 * Query di `GET /legami-movimento` (4.3b, Task 22). I valori arrivano come testo dalla query
 * string e il servizio (`normalizzaFiltri`) li valida e li converte: 400 `FILTRI_LISTA_NON_VALIDI`.
 * Il DTO fa solo da lista bianca dei nomi (parametro sconosciuto: 400).
 */
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString } from 'class-validator'

export class ListaLegamiQueryDto {
  @ApiPropertyOptional({ description: 'Uno stato della lista (anche MANCANTE, DA_RIALLINEARE)' })
  @IsOptional()
  @IsString({ message: 'Lo stato non è valido.' })
  stato?: string

  @ApiPropertyOptional({ description: 'Più stati separati da virgola, o parametro ripetuto' })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.join(',') : value))
  @IsString({ message: 'Gli stati non sono validi.' })
  stati?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Il cliente non è valido.' })
  clienteId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Il registro non è valido.' })
  registroId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Il motivo non è valido.' })
  motivo?: string

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString({ message: 'La data iniziale non è valida.' })
  dal?: string

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @IsString({ message: 'La data finale non è valida.' })
  al?: string

  @ApiPropertyOptional({ description: '«true» per includere gli esclusi' })
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'Il filtro «esclusi» deve essere true o false.' })
  esclusi?: string

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString({ message: 'La pagina non è valida.' })
  pagina?: string

  @ApiPropertyOptional({ example: '50' })
  @IsOptional()
  @IsString({ message: 'La dimensione della pagina non è valida.' })
  dimensione?: string
}
