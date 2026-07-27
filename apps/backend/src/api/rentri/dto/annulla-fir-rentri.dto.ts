import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * Motivo dell'annullamento del formulario RENTRI (R3 Task 5), da
 * trasmettere all'ente come nota di annullamento
 * (`NoteAnnullamentoModel.note`, `docs/contracts/rentri/formulari.yaml`,
 * righe 9895-9906, `maxLength: 1024`). Validato qui, prima ancora di
 * raggiungere lo use case (che lo rivalida comunque, fail-closed su due
 * livelli, stesso principio già applicato per `AccettaFirRentriDto`).
 */
export class AnnullaFirRentriDto {
  @ApiProperty({
    description: "Motivo dell'annullamento — verrà trasmesso all'ente come nota di annullamento.",
    maxLength: 1024,
  })
  @IsString()
  @IsNotEmpty({ message: "Il motivo dell'annullamento è obbligatorio" })
  @MaxLength(1024, { message: 'Il motivo non può superare 1024 caratteri' })
  motivo: string

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
