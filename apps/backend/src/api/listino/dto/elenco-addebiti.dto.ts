/**
 * DTO delle rotte degli elenchi degli addebiti (4.2b, D8, R39). Il DTO controlla forma e tipi; le
 * regole sui valori (codice, date, CIG/CUP, lunghezze) sono del dominio `elenco-addebiti` e
 * rispondono con l'elenco dei messaggi in italiano.
 *
 * `predefinito` e' un booleano vero: le stringhe "true"/"false" (query o form) si convertono qui,
 * perche' il dominio controlla `=== true`. Nessun `PartialType`: un campo o manca, o ha il tipo
 * giusto; `null` e' ammesso solo per i campi facoltativi (li svuota in modifica).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator'

const aBooleano = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value

export class CreaElencoAddebitiDto {
  @ApiPropertyOptional({ example: '001', description: 'Omesso: il primo numero libero' })
  @IsOptional()
  @IsString()
  codice?: string

  @ApiProperty({ example: 'Listino 2026' })
  @IsString()
  descrizione: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nota1?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nota2?: string | null

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Insieme a validoAl, o nessuna' })
  @IsOptional()
  @IsString()
  validoDal?: string | null

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  validoAl?: string | null

  @ApiPropertyOptional({ description: 'Omesso = false; true toglie il flag agli altri elenchi' })
  @Transform(aBooleano)
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  predefinito?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codiceCig?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codiceCup?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idDocumentoPa?: string | null

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  dataDocumentoPa?: string | null
}

export class ModificaElencoAddebitiDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  codice?: string

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  descrizione?: string

  @ApiPropertyOptional({ description: 'null = svuota' })
  @IsOptional()
  @IsString()
  nota1?: string | null

  @ApiPropertyOptional({ description: 'null = svuota' })
  @IsOptional()
  @IsString()
  nota2?: string | null

  @ApiPropertyOptional({ description: 'null = svuota (insieme a validoAl)' })
  @IsOptional()
  @IsString()
  validoDal?: string | null

  @ApiPropertyOptional({ description: 'null = svuota (insieme a validoDal)' })
  @IsOptional()
  @IsString()
  validoAl?: string | null

  @ApiPropertyOptional()
  @Transform(aBooleano)
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  predefinito?: boolean

  @ApiPropertyOptional({ description: 'null = svuota' })
  @IsOptional()
  @IsString()
  codiceCig?: string | null

  @ApiPropertyOptional({ description: 'null = svuota' })
  @IsOptional()
  @IsString()
  codiceCup?: string | null

  @ApiPropertyOptional({ description: 'null = svuota' })
  @IsOptional()
  @IsString()
  idDocumentoPa?: string | null

  @ApiPropertyOptional({ description: 'null = svuota' })
  @IsOptional()
  @IsString()
  dataDocumentoPa?: string | null

  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
