/** DTO di `POST :id/conferma`, `escludi` e `riammetti` (4.3b, Task 22, spec §8.1). */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator'
import { ModificheLegameDto } from './modifica-legame.dto'

export class RiammettiLegameDto {
  @ApiProperty({ example: 1 })
  @IsInt({ message: 'La versione deve essere un numero intero.' })
  @Min(1, { message: 'La versione parte da 1.' })
  versione: number
}

export class ConfermaLegameDto extends RiammettiLegameDto {
  @ApiPropertyOptional({ type: ModificheLegameDto, description: 'Stesse modifiche del PUT' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ModificheLegameDto)
  modifiche?: ModificheLegameDto
}

export class EscludiLegameDto extends RiammettiLegameDto {
  @ApiProperty({ example: 'Contratto a forfait', description: '1-200 caratteri dopo il trim' })
  @IsString({ message: 'Il motivo deve essere un testo.' })
  @MaxLength(1000, { message: 'Il motivo è troppo lungo.' })
  motivo: string
}
