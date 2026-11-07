/** Query di `GET /documenti-fattura` (4.4b1, §11): date solo `AAAA-MM-GG`, id UUID, pagina 1-100. */
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator'
import { STATI_DOCUMENTO } from '../../../domain/fatturazione/codici'
import { PaginaQueryDto } from './lista-elaborazioni.dto'

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

export class ListaDocumentiQueryDto extends PaginaQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  registroIvaId?: string

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anno?: number

  @ApiPropertyOptional({ enum: STATI_DOCUMENTO as unknown as string[] })
  @IsOptional()
  @IsIn(STATI_DOCUMENTO as unknown as string[])
  stato?: (typeof STATI_DOCUMENTO)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string

  @ApiPropertyOptional({ description: 'Solo i documenti generati da questa elaborazione' })
  @IsOptional()
  @IsUUID()
  elaborazioneId?: string

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(DATA_ISO, { message: 'dataDa: data nel formato AAAA-MM-GG.' })
  dataDa?: string

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @Matches(DATA_ISO, { message: 'dataA: data nel formato AAAA-MM-GG.' })
  dataA?: string
}

export class DocumentoParamDto {
  @IsUUID()
  id: string
}
