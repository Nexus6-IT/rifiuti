import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const ANNO_MIN = 2000
const ANNO_MAX = 2100

/** Query `?anno=` dell'allineamento. */
export class AllineamentoQueryDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt({ message: "L'anno deve essere un numero intero." })
  @Min(ANNO_MIN, { message: `L'anno non può essere precedente al ${ANNO_MIN}.` })
  @Max(ANNO_MAX, { message: `L'anno non può essere successivo al ${ANNO_MAX}.` })
  anno: number
}

/** `PUT /rentri/registro/registri/:registroId` (solo amministratori). */
export class ImpostaRegistroRentriDto {
  @ApiPropertyOptional({
    nullable: true,
    example: 'RABCDE12345',
    description:
      'Identificativo del registro su RENTRI; null o vuoto lo toglie, assente lo lascia.',
  })
  @IsOptional()
  @IsString({ message: "L'identificativo del registro deve essere un testo." })
  @MaxLength(20, { message: "L'identificativo del registro è troppo lungo." })
  identificativoRentri?: string | null

  @ApiPropertyOptional({ description: "Attiva o disattiva l'invio automatico (da ora in poi)." })
  @IsOptional()
  @IsBoolean({ message: "L'invio automatico deve essere vero o falso." })
  invioAutomatico?: boolean
}

/** `POST /rentri/registro/trasmetti`. */
export class TrasmettiRentriDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Il registro indicato non è valido.' })
  registroId: string

  @ApiProperty({ type: [String], description: 'Annotazioni da trasmettere (da 1 a 1000).' })
  @IsArray({ message: 'Le annotazioni devono essere un elenco.' })
  @ArrayMinSize(1, { message: "Indica almeno un'annotazione da trasmettere." })
  @ArrayMaxSize(1000, { message: 'Si possono trasmettere al massimo 1000 annotazioni per volta.' })
  @IsUUID('all', { each: true, message: 'Una delle annotazioni indicate non è valida.' })
  movimentoIds: string[]
}

/** `POST /rentri/registro/trasmetti-storico` (solo amministratori). */
export class TrasmettiStoricoRentriDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Il registro indicato non è valido.' })
  registroId: string

  @ApiProperty({ example: 2025 })
  @IsInt({ message: "L'anno deve essere un numero intero." })
  @Min(ANNO_MIN, { message: `L'anno non può essere precedente al ${ANNO_MIN}.` })
  @Max(ANNO_MAX, { message: `L'anno non può essere successivo al ${ANNO_MAX}.` })
  anno: number

  @ApiProperty({ example: true })
  @Equals(true, {
    message: "Per trasmettere lo storico serve la conferma esplicita dell'operazione.",
  })
  conferma: true
}

/** `POST /rentri/registro/dichiara-gia-trasmessi` (solo amministratori). */
export class DichiaraGiaTrasmessiDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Il registro indicato non è valido.' })
  registroId: string

  @ApiProperty({ example: 2026 })
  @IsInt({ message: "L'anno deve essere un numero intero." })
  @Min(ANNO_MIN, { message: `L'anno non può essere precedente al ${ANNO_MIN}.` })
  @Max(ANNO_MAX, { message: `L'anno non può essere successivo al ${ANNO_MAX}.` })
  anno: number

  @ApiProperty({ example: 1 })
  @IsInt({ message: 'Il primo numero deve essere un numero intero.' })
  @Min(1, { message: 'Il primo numero deve essere almeno 1.' })
  daProgressivo: number

  @ApiProperty({ example: 120 })
  @IsInt({ message: "L'ultimo numero deve essere un numero intero." })
  @Min(1, { message: "L'ultimo numero deve essere almeno 1." })
  aProgressivo: number

  @ApiProperty({ example: 'Già trasmessi dal programma precedente' })
  @IsString({ message: 'Il motivo deve essere un testo.' })
  @IsNotEmpty({ message: 'Indica il motivo della dichiarazione.' })
  @MaxLength(500, { message: 'Il motivo può avere al massimo 500 caratteri.' })
  motivo: string
}

/** `POST /rentri/registro/movimenti/:id/escludi-invio-automatico` (solo amministratori). */
export class EscludiInvioAutomaticoDto {
  @ApiProperty({ example: 'Annotazione da correggere prima di inviarla' })
  @IsString({ message: 'Il motivo deve essere un testo.' })
  @IsNotEmpty({ message: "Indica il motivo dell'esclusione." })
  @MaxLength(500, { message: 'Il motivo può avere al massimo 500 caratteri.' })
  motivo: string
}

/** `DELETE /rentri/registro/movimenti/:id/coda`: il motivo serve solo agli amministratori. */
export class TogliDallaCodaDto {
  @ApiPropertyOptional({
    description:
      "Solo per le annotazioni dell'invio automatico: un amministratore le esclude indicando il motivo.",
  })
  @IsOptional()
  @IsString({ message: 'Il motivo deve essere un testo.' })
  @MaxLength(500, { message: 'Il motivo può avere al massimo 500 caratteri.' })
  motivo?: string
}
