import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * Scelta esplicita dell'utente su come agganciare un formulario RENTRI
 * trovato (R2 Task 4/6): mai una terza opzione implicita "indovina tu".
 *
 * - `NUOVO`: crea un FIR locale da zero a partire dal dettaglio RENTRI.
 * - `ESISTENTE`: completa un FIR locale già presente (`firId` obbligatorio).
 */
export class AgganciaFormularioRentriDto {
  @ApiProperty({ enum: ['NUOVO', 'ESISTENTE'], description: 'Come agganciare il formulario' })
  @IsIn(['NUOVO', 'ESISTENTE'])
  modalita: 'NUOVO' | 'ESISTENTE'

  @ApiPropertyOptional({
    description:
      'Id del FIR locale a cui collegare il formulario (richiesto se modalita=ESISTENTE)',
  })
  @ValidateIf(dto => dto.modalita === 'ESISTENTE')
  @IsString()
  @IsNotEmpty()
  firId?: string

  @ApiPropertyOptional({
    description:
      'Dal risultato di GET /rentri/formulari: se true, la visibilità del formulario è già stata ' +
      'acquisita in un giro precedente e non va richiesta di nuovo a RENTRI. Assente/false per ' +
      'default: nel caso peggiore produce una chiamata di acquisizione non necessaria (comunque ' +
      "sicura, mai una doppia scrittura locale), mai l'omissione di una acquisizione necessaria.",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  visibilitaGiaAcquisita?: boolean

  @ApiPropertyOptional({ description: 'Id di correlazione per tracciare la richiesta nei log' })
  @IsOptional()
  @IsString()
  correlationId?: string
}
