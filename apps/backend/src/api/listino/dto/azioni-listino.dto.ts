/**
 * DTO delle azioni sul listino (4.2b, Task 23, D18, D19, R45). Il DTO controlla forma e tipi; le
 * regole sui valori (percentuali a cascata, tipo di provvigione) sono del servizio, che risponde
 * 400 con `details.errori` (R60). Provvigione e sconti ammettono `null` o vuoto (li svuotano).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator'

/** Righe che si possono scegliere in una sola volta (un elenco ne ha al massimo qualche centinaio). */
export const MAX_RIGHE_DA_COPIARE = 1000

/** Stringa oppure numero finito: il servizio ne controlla il formato. */
function IsTestoONumero(opzioni?: ValidationOptions) {
  return (oggetto: object, proprieta: string) =>
    registerDecorator({
      name: 'isTestoONumero',
      target: oggetto.constructor,
      propertyName: proprieta,
      options: { message: `${proprieta} deve essere un testo o un numero`, ...opzioni },
      validator: {
        validate: (v: unknown) =>
          typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
      },
    })
}

export class SostituisciDaDto {
  @ApiProperty({ description: 'Elenco da cui copiare le righe (altra azienda: 404)' })
  @IsUUID()
  daElencoId: string

  @ApiProperty({ description: 'Versione dell’elenco di arrivo letta dal client' })
  @IsInt()
  @Min(1)
  versione: number
}

export class AggiungiRigheDto {
  @ApiProperty({ type: [String], description: 'Righe da copiare nell’elenco' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RIGHE_DA_COPIARE)
  @IsUUID('all', { each: true })
  righeIds: string[]

  @ApiProperty()
  @IsInt()
  @Min(1)
  versione: number
}

export class ProvvigioniContrattoDto {
  @ApiPropertyOptional({ nullable: true, example: '10+5', description: 'Vuota o null: svuota' })
  @IsOptional()
  @IsTestoONumero()
  provvigione?: string | number | null

  @ApiPropertyOptional({ nullable: true, enum: ['SCONTATO', 'LORDO'] })
  @IsOptional()
  @IsString()
  tipoProvvigione?: string | null
}

export class ScontiContrattoDto {
  @ApiProperty({ example: '10+5', description: 'Lo sconto da sostituire' })
  @IsTestoONumero()
  scontoAttuale: string | number

  @ApiPropertyOptional({
    nullable: true,
    example: '12',
    description: 'Vuoto o null: toglie lo sconto',
  })
  @IsOptional()
  @IsTestoONumero()
  scontoNuovo?: string | number | null
}
