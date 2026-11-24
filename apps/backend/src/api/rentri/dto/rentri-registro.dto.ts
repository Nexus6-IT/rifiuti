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

/** `POST /rentri/registro/registri/:registroId/rentri/collega` (solo amministratori). */
export class CollegaRegistroRentriDto {
  @ApiProperty({ example: 'RABCDE12345', description: 'Identificativo del registro su RENTRI.' })
  @IsString({ message: "L'identificativo del registro deve essere un testo." })
  @IsNotEmpty({ message: "Indica l'identificativo del registro RENTRI." })
  @MaxLength(20, { message: "L'identificativo del registro è troppo lungo." })
  identificativo: string
}

/** `POST /rentri/registro/registri/:registroId/rentri/apri` (solo amministratori). */
export class ApriRegistroRentriDto {
  @ApiProperty({ type: [String], example: ['Produzione'] })
  @IsArray({ message: 'Le attività devono essere un elenco.' })
  @ArrayMinSize(1, { message: "Indica almeno un'attività del registro." })
  @ArrayMaxSize(6, { message: 'Troppe attività indicate.' })
  @IsString({ each: true, message: 'Ogni attività deve essere un testo.' })
  attivita: string[]

  @ApiPropertyOptional({ type: [String], example: ['R13'] })
  @IsOptional()
  @IsArray({ message: 'I codici di recupero e smaltimento devono essere un elenco.' })
  @ArrayMaxSize(28, { message: 'Troppi codici di recupero e smaltimento.' })
  @IsString({ each: true, message: 'Ogni codice deve essere un testo.' })
  attivitaRecSmalt?: string[]

  @ApiPropertyOptional({
    maxLength: 250,
    description: 'Assente = descrizione del registro locale.',
  })
  @IsOptional()
  @IsString({ message: 'La descrizione deve essere un testo.' })
  @MaxLength(250, { message: 'La descrizione può avere al massimo 250 caratteri.' })
  descrizione?: string
}

/** `PUT /rentri/registro/registri/:registroId/rentri` (solo amministratori). */
export class ModificaRegistroRentriDto {
  @ApiPropertyOptional({ maxLength: 250 })
  @IsOptional()
  @IsString({ message: 'La descrizione deve essere un testo.' })
  @MaxLength(250, { message: 'La descrizione può avere al massimo 250 caratteri.' })
  descrizione?: string

  @ApiPropertyOptional({ type: [String], example: ['R13'] })
  @IsOptional()
  @IsArray({ message: 'I codici di recupero e smaltimento devono essere un elenco.' })
  @ArrayMaxSize(28, { message: 'Troppi codici di recupero e smaltimento.' })
  @IsString({ each: true, message: 'Ogni codice deve essere un testo.' })
  attivitaRecSmalt?: string[]

  @ApiPropertyOptional({
    description: 'Salva i codici R/D anche se non coincidono con le autorizzazioni della sede.',
  })
  @IsOptional()
  @IsBoolean({ message: 'Il campo «forza» deve essere vero o falso.' })
  forza?: boolean
}

/** `POST /rentri/registro/registri/:registroId/rentri/chiudi` (solo amministratori). */
export class ChiudiRegistroRentriDto {
  @ApiProperty({
    example: 'RABCDE12345',
    description: 'Doppia conferma: l identificativo del registro, digitato per esteso.',
  })
  @IsString({ message: "La conferma deve essere l'identificativo del registro." })
  @IsNotEmpty({ message: "Digita l'identificativo del registro per confermare." })
  @MaxLength(20, { message: "La conferma non è l'identificativo del registro." })
  conferma: string
}
