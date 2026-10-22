import { ApiProperty } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import {
  MOTIVI_ANNULLAMENTO,
  type MotivoAnnullamento,
} from '../../../application/mud/mud-report-data'

/** Corpo di `DELETE mud/:year/presentazione`: perché si annulla la presentazione (A-W-04). */
export class AnnullaPresentazioneDto {
  @ApiProperty({
    enum: MOTIVI_ANNULLAMENTO,
    description:
      'SEGNATURA_ERRATA: il MUD non era stato presentato davvero; il prossimo file è una prima ' +
      'dichiarazione. DICHIARAZIONE_DA_SOSTITUIRE: il MUD presentato va sostituito; il ' +
      'prossimo file annulla e sostituisce quella comunicazione.',
  })
  @IsIn(MOTIVI_ANNULLAMENTO)
  motivo!: MotivoAnnullamento
}
