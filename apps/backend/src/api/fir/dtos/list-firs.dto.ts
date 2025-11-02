/**
 * List FIRs DTO - Query parameters validation
 */

import { IsOptional, IsString, IsEnum, IsNumberString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'

export class ListFIRsDto {
  @ApiPropertyOptional({ example: '1', description: 'Numero pagina (default: 1)' })
  @IsOptional()
  @IsNumberString()
  page?: string

  @ApiPropertyOptional({ example: '10', description: 'Elementi per pagina (default: 10)' })
  @IsOptional()
  @IsNumberString()
  limit?: string

  @ApiPropertyOptional({
    enum: FIRStato,
    description: 'Filtra per stato FIR',
  })
  @IsOptional()
  @IsEnum(FIRStato)
  stato?: FIRStato

  @ApiPropertyOptional({
    example: '13 02 05*',
    description: 'Filtra per codice CER',
  })
  @IsOptional()
  @IsString()
  cerCode?: string

  @ApiPropertyOptional({
    example: '2025-01-01',
    description: 'Data inizio periodo (ISO 8601)',
  })
  @IsOptional()
  @IsString()
  dataFrom?: string

  @ApiPropertyOptional({
    example: '2025-12-31',
    description: 'Data fine periodo (ISO 8601)',
  })
  @IsOptional()
  @IsString()
  dataTo?: string
}
