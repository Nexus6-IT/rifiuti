/**
 * FIR Response DTO - API output
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { FIR, FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'

export class FIRResponseDto {
  @ApiProperty({ example: 'uuid-123', description: 'ID univoco FIR' })
  id: string

  @ApiPropertyOptional({
    example: 'FIR-2025-001234',
    description: 'Numero progressivo (assegnato all\'emissione)',
  })
  numeroProgressivo: string | null

  @ApiProperty({ enum: FIRStato, example: FIRStato.BOZZA, description: 'Stato FIR' })
  stato: FIRStato

  @ApiProperty({ example: 'tenant-uuid-producer', description: 'ID produttore' })
  produttoreId: string

  @ApiProperty({
    example: { cerCode: '13 02 05*', quantita: 120, unitaMisura: 'kg' },
    description: 'Dettagli rifiuto',
  })
  rifiuto: {
    cerCode: string
    quantita: number
    unitaMisura: string
    statoFisico?: string
    caratteristichePericolo?: string
  }

  @ApiProperty({ example: 'tenant-uuid-transporter', description: 'ID trasportatore' })
  trasportatoreId: string

  @ApiProperty({ example: 'tenant-uuid-destination', description: 'ID destinatario' })
  destinatarioId: string

  @ApiPropertyOptional({ description: 'Data presa in carico trasportatore' })
  dataPresaCarico: Date | null

  @ApiPropertyOptional({ description: 'Data consegna destinatario' })
  dataConsegna: Date | null

  @ApiPropertyOptional({ example: 118, description: 'Peso effettivo alla destinazione' })
  pesoEffettivo: number | null

  @ApiProperty({ description: 'Data creazione' })
  createdAt: Date

  static fromDomain(fir: FIR): FIRResponseDto {
    return {
      id: fir.id,
      numeroProgressivo: fir.numeroProgressivo,
      stato: fir.stato,
      produttoreId: fir.produttoreId,
      rifiuto: {
        cerCode: fir.rifiuto.cerCode,
        quantita: fir.rifiuto.quantita.valore,
        unitaMisura: fir.rifiuto.quantita.unitaMisura,
        statoFisico: fir.rifiuto.statoFisico,
        caratteristichePericolo: fir.rifiuto.caratteristichePericolo,
      },
      trasportatoreId: fir.trasportatoreId,
      destinatarioId: fir.destinatarioId,
      dataPresaCarico: fir.dataPresaCarico,
      dataConsegna: fir.dataConsegna,
      pesoEffettivo: fir.pesoEffettivo,
      createdAt: fir.createdAt,
    }
  }
}
