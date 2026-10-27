import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { RegistraMovimentoDto } from './registra-movimento.dto'
import { RegistroIdQueryDto } from './registro-id-query.dto'

/** Lunghezza massima del motivo di una correzione (R4, coerente col caso d'uso). */
export const MOTIVO_CORREZIONE_MASSIMO = 500

const togliSpazi = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** Motivo e conferma comuni a rettifica e annullamento. */
export class AnnullaMovimentoDto {
  @ApiProperty({
    description: 'Motivo della correzione (1-500 caratteri, spazi ai bordi esclusi)',
    maxLength: MOTIVO_CORREZIONE_MASSIMO,
  })
  @Transform(togliSpazi)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MOTIVO_CORREZIONE_MASSIMO)
  motivo: string

  @ApiPropertyOptional({
    description:
      'Conferma di chi sa che la correzione tocca anni il cui MUD risulta già presentato: ' +
      'senza, la correzione è respinta con 409 REGISTRO_ANNO_MUD_PRESENTATO.',
  })
  @IsBoolean()
  @IsOptional()
  confermaAnnoPresentato?: boolean
}

/**
 * Corpo della rettifica: i dati completi nuovi dell'annotazione. Tipo, registro, FIR e data di
 * registrazione non si cambiano: restano quelli dell'annotazione corretta (e, con
 * `forbidNonWhitelisted`, inviarli e' un 400).
 */
export class RettificaMovimentoDto extends OmitType(RegistraMovimentoDto, [
  'type',
  'registroId',
  'firId',
  'registrationDate',
] as const) {
  @ApiProperty({
    description: 'Motivo della correzione (1-500 caratteri, spazi ai bordi esclusi)',
    maxLength: MOTIVO_CORREZIONE_MASSIMO,
  })
  @Transform(togliSpazi)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MOTIVO_CORREZIONE_MASSIMO)
  motivo: string

  @ApiPropertyOptional({
    description:
      'Conferma di chi sa che la correzione tocca anni il cui MUD risulta già presentato.',
  })
  @IsBoolean()
  @IsOptional()
  confermaAnnoPresentato?: boolean
}

/**
 * Query della verifica della catena: registro facoltativo (predefinito se omesso) e anno. Il
 * limite superiore dell'anno (anno corrente + 1) lo controlla il controller, perche' cambia
 * con il tempo e un decoratore lo fisserebbe all'avvio del processo.
 */
export class VerificaCatenaQueryDto extends RegistroIdQueryDto {
  @ApiProperty({
    description: 'Anno del registro da verificare (da 2000 a anno corrente + 1)',
    minimum: 2000,
  })
  @Transform(({ value }) =>
    typeof value === 'string' && /^[0-9]+$/.test(value) ? parseInt(value, 10) : value
  )
  @IsInt()
  @Min(2000)
  anno: number
}
