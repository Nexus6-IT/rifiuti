import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'

const tagliaSpazi = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/**
 * Corpo di `POST` e `PUT /pese/strumenti`. I valori numerici (portata, divisione) e la data
 * li valida il servizio, che risponde 400 con tutti i messaggi in italiano.
 */
export class StrumentoPesaDto {
  @ApiProperty({ maxLength: 255 })
  @IsString({ message: 'La descrizione è obbligatoria.' })
  @MaxLength(255, { message: 'La descrizione può avere al massimo 255 caratteri.' })
  @Transform(tagliaSpazi)
  descrizione!: string

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Il costruttore può avere al massimo 100 caratteri.' })
  costruttore?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Il modello può avere al massimo 100 caratteri.' })
  modello?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'La matricola può avere al massimo 100 caratteri.' })
  matricola?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Registro (sede) dello strumento' })
  @IsOptional()
  @IsUUID('all', { message: 'Registro non valido.' })
  registroId?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Portata massima in kg (> 0)' })
  @IsOptional()
  @IsNumber({}, { message: 'La portata massima deve essere un numero.' })
  portataMaxKg?: number | null

  @ApiPropertyOptional({ nullable: true, description: 'Divisione in kg (> 0)' })
  @IsOptional()
  @IsNumber({}, { message: 'La divisione deve essere un numero.' })
  divisioneKg?: number | null

  @ApiPropertyOptional({ nullable: true, example: '2026-03-10' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La data dell’ultima verificazione deve essere nel formato AAAA-MM-GG.',
  })
  dataUltimaVerificazione?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  attivo?: boolean
}
