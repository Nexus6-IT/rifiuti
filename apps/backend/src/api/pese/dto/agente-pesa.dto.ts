import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator'

const senzaSpazi = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** Corpo di `POST /pese/agenti`. */
export class CreaAgenteDto {
  @ApiProperty({ maxLength: 255, description: 'Nome riconoscibile del PC della pesa' })
  @IsString({ message: 'La descrizione è obbligatoria.' })
  @Transform(senzaSpazi)
  @Length(1, 255, { message: 'La descrizione è obbligatoria (al massimo 255 caratteri).' })
  descrizione!: string

  @ApiPropertyOptional({ nullable: true, description: 'Sede (registro) dove sta il PC' })
  @IsOptional()
  @IsUUID('all', { message: 'Registro non valido.' })
  registroId?: string | null
}

/** Corpo di `PUT /pese/strumenti/:id/agente`: `agenteId` nullo libera lo strumento. */
export class AssegnaAgenteDto {
  @ApiProperty({ nullable: true, type: String })
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('all', { message: 'Agente non valido.' })
  agenteId!: string | null
}

const comeBooleano = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value

/** Query di `GET /pese/letture`. */
export class ElencoLettureQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Registro non valido.' })
  registroId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Strumento non valido.' })
  strumentoId?: string

  @ApiPropertyOptional({ description: 'Solo le letture non ancora usate (default true)' })
  @IsOptional()
  @Transform(comeBooleano)
  @IsBoolean({ message: 'libere deve essere true o false.' })
  libere?: boolean

  @ApiPropertyOptional({
    description: 'Dall’ora dell’agente in poi, ISO 8601 (default ultime 24 ore)',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'La data non è valida.' })
  dal?: string
}
