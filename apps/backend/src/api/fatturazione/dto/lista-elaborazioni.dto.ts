/**
 * Query di `GET /elaborazioni-fatturazione` e `GET /elaborazioni-fatturazione/:id/documenti`
 * (4.4b1, §11). `dimensione` ha il tetto di 100 (lezione 4.3c I6: oltre, 400); `pagina` parte da 1.
 * `PaginaQueryDto` e' la base di tutte le liste della fatturazione.
 */
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import { STATI_ELABORAZIONE } from '../../../domain/fatturazione/codici'

export const DIMENSIONE_PREDEFINITA = 50
export const DIMENSIONE_MASSIMA = 100

export class PaginaQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: DIMENSIONE_MASSIMA, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DIMENSIONE_MASSIMA)
  dimensione: number = DIMENSIONE_PREDEFINITA
}

export class ListaElaborazioniQueryDto extends PaginaQueryDto {
  @ApiPropertyOptional({ enum: STATI_ELABORAZIONE as unknown as string[] })
  @IsOptional()
  @IsIn(STATI_ELABORAZIONE as unknown as string[])
  stato?: (typeof STATI_ELABORAZIONE)[number]
}

export class DocumentiElaborazioneQueryDto extends PaginaQueryDto {
  @ApiPropertyOptional({ description: 'true: solo i documenti con errori' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  conErrori?: boolean
}
