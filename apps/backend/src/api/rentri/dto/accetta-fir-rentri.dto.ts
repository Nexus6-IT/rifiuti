import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * Scelta esplicita dell'utente su come accettare/respingere un carico
 * ricevuto (R3 Task 4). `tipoAccettazione` rispecchia l'enum stringa
 * `TipiAccettazione` del contratto (`docs/contracts/rentri/formulari.yaml`,
 * righe 10233-10238), NON un intero:
 * - `A` = Accettato per intero
 * - `P` = Accettato parzialmente
 * - `R` = Respinto
 *
 * I campi condizionali (`quantitaAccettataKg` per A/P; `causaleRespingimento`
 * + `motivoRespingimento` per P/R) sono validati qui con `@ValidateIf`, prima
 * ancora di raggiungere lo use case (che li rivalida comunque, fail-closed su
 * due livelli, stesso principio già applicato altrove nel progetto).
 */
export class AccettaFirRentriDto {
  @ApiProperty({
    enum: ['A', 'P', 'R'],
    description: "Esito dell'accettazione: A = intera, P = parziale, R = respinto",
  })
  @IsIn(['A', 'P', 'R'], {
    message: "tipoAccettazione deve essere uno tra 'A' (intera), 'P' (parziale), 'R' (respinto)",
  })
  tipoAccettazione: 'A' | 'P' | 'R'

  @ApiPropertyOptional({
    description:
      "Data e ora di arrivo del carico presso il destinatario (ISO 8601 UTC). Se assente, si usa l'istante corrente.",
  })
  @IsOptional()
  @IsISO8601({}, { message: 'dataOraArrivo deve essere una data ISO 8601 valida' })
  dataOraArrivo?: string

  @ApiPropertyOptional({
    description: "Quantità accettata in kg — obbligatoria per un'accettazione intera o parziale.",
  })
  @ValidateIf(dto => dto.tipoAccettazione === 'A' || dto.tipoAccettazione === 'P')
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    {
      message:
        'quantitaAccettataKg è obbligatoria (numero con al massimo 2 decimali) per un’accettazione intera o parziale',
    }
  )
  quantitaAccettataKg?: number

  @ApiPropertyOptional({
    enum: ['NC', 'IR', 'A'],
    description:
      'Causale del respingimento (NC = non conformità, IR = irricevibile, A = altro) — ' +
      "obbligatoria per un respingimento o un'accettazione parziale.",
  })
  @ValidateIf(dto => dto.tipoAccettazione === 'P' || dto.tipoAccettazione === 'R')
  @IsIn(['NC', 'IR', 'A'], {
    message:
      "causaleRespingimento è obbligatoria (NC/IR/A) per un respingimento o un'accettazione parziale",
  })
  causaleRespingimento?: 'NC' | 'IR' | 'A'

  @ApiPropertyOptional({
    description:
      'Motivazione libera del respingimento — obbligatoria per un respingimento o un’accettazione parziale.',
    maxLength: 1000,
  })
  @ValidateIf(dto => dto.tipoAccettazione === 'P' || dto.tipoAccettazione === 'R')
  @IsString()
  @IsNotEmpty({
    message:
      "motivoRespingimento è obbligatorio per un respingimento o un'accettazione parziale: indica il motivo in testo libero",
  })
  motivoRespingimento?: string

  @ApiPropertyOptional({
    description: 'Indica se il carico è in attesa di verifica analitica.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  attesaVerificaAnalitica?: boolean

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
