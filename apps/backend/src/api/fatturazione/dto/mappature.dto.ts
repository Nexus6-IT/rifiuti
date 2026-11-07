/**
 * Corpo e parametri delle rotte `/export-contabile/:adattatore/mappature` (4.4c, Task 29). L'azienda
 * e` quella selezionata nella richiesta, mai nel corpo. `valore: null` cancella la voce.
 */
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { TIPI_MAPPATURA } from '../../../application/fatturazione/adattatori/adattatore-export-contabile'
import type { TipoMappatura } from '../../../application/fatturazione/adattatori/adattatore-export-contabile'
import { MAX_VOCI_MAPPATURE } from '../../../application/fatturazione/adattatori/mappature.service'

export class ParametriAdattatoreDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  adattatore: string
}

export class VoceMappaturaDto {
  @ApiProperty({ enum: TIPI_MAPPATURA })
  @IsIn(TIPI_MAPPATURA as readonly string[])
  tipo: TipoMappatura

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  chiaveWasteflow: string

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 50,
    description: '`null` cancella la voce',
  })
  @IsDefined()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  valore: string | null
}

export class ImpostaMappatureDto {
  @ApiProperty({ type: [VoceMappaturaDto], maxItems: MAX_VOCI_MAPPATURE })
  @IsArray()
  @ArrayMaxSize(MAX_VOCI_MAPPATURE)
  @ValidateNested({ each: true })
  @Type(() => VoceMappaturaDto)
  voci: VoceMappaturaDto[]
}
