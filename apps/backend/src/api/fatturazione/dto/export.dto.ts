/**
 * Corpo di `POST /documenti-fattura/export` (4.4b2, §11-§12): formato, selezione dei documenti e
 * conferma di emissione. L'azienda e` quella selezionata nella richiesta, mai nel corpo.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
/**
 * Id espliciti per richiesta. Il limite del corpo JSON (100 KB, predefinito di Express) taglia prima
 * dei 5000 del CSV: ~38 byte per id. Oltre si usano i filtri; il tetto dei documenti resta del servizio.
 */
export const MAX_ID_EXPORT = 2000

export class SelezioneExportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  registroIvaId?: string

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  anno?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  numeroDa?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  numeroA?: number

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(DATA_ISO, { message: 'dataDa: data nel formato AAAA-MM-GG.' })
  dataDa?: string

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @Matches(DATA_ISO, { message: 'dataA: data nel formato AAAA-MM-GG.' })
  dataA?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clienteId?: string

  @ApiPropertyOptional({ maxItems: MAX_ID_EXPORT })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ID_EXPORT)
  @IsUUID('all', { each: true })
  documentoIds?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  elaborazioneId?: string
}

export class EsportaDto {
  @ApiProperty({ description: '`CSV`, `XML_ZIP` o il codice di un adattatore', example: 'CSV' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  formato: string

  @ApiProperty({ type: SelezioneExportDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SelezioneExportDto)
  selezione: SelezioneExportDto

  @ApiPropertyOptional({ description: 'Richiesta per XML_ZIP e adattatori; ignorata dal CSV' })
  @IsOptional()
  @IsBoolean()
  confermaEmissione?: boolean
}
