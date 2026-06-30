/**
 * FIR Response DTO - API output
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { FIR, FIRStato, ParteFIR, TipoTratta } from '../../../domain/fir/aggregates/fir.aggregate'

/** Trasportatore aggiuntivo (tratta intermodale) nella risposta del FIR. */
export class TrasportatoreAggiuntivoResponse {
  @ApiProperty({ example: 2, description: 'Ordine della tratta (1-based)' })
  ordine: number

  @ApiProperty({ enum: TipoTratta, example: TipoTratta.FERROVIARIA, description: 'Tipo di tratta' })
  tipoTratta: TipoTratta

  @ApiProperty({ example: 'Trasporti Rossi Srl', description: 'Denominazione (snapshot)' })
  denominazione: string

  @ApiPropertyOptional({ example: '12345678901', description: 'Partita IVA (snapshot)' })
  partitaIva?: string

  @ApiPropertyOptional({ example: 'RSSMRA80A01H501U', description: 'Codice fiscale (snapshot)' })
  codiceFiscale?: string

  @ApiPropertyOptional({
    example: 'MI/000123',
    description: 'Numero iscrizione Albo gestori (snapshot)',
  })
  numeroIscrizioneAlbo?: string

  @ApiPropertyOptional({
    example: 'AB123CD',
    description: 'Mezzo/identificativo (targa, treno, nave)',
  })
  mezzo?: string
}

export class FIRResponseDto {
  @ApiProperty({ example: 'uuid-123', description: 'ID univoco FIR' })
  id: string

  @ApiPropertyOptional({
    example: 'FIR-2025-001234',
    description: "Numero progressivo (assegnato all'emissione)",
  })
  numeroProgressivo: string | null

  @ApiProperty({ enum: FIRStato, example: FIRStato.BOZZA, description: 'Stato FIR' })
  stato: FIRStato

  @ApiProperty({ example: 'tenant-uuid-producer', description: 'ID produttore' })
  produttoreId: string

  @ApiProperty({
    example: {
      cerCode: '13 02 05*',
      quantita: 120,
      unitaMisura: 'kg',
      statoFisico: 'Liquido',
      numeroColli: 5,
    },
    description: 'Dettagli rifiuto (Campo 2 FIR)',
  })
  rifiuto: {
    cerCode: string
    quantita: number
    unitaMisura: string
    /** Campo 2 FIR: stato fisico (DM 59/2023). */
    statoFisico?: string
    /** Campo 2 FIR: caratteristiche HP (Reg. UE 1357/2014). */
    caratteristichePericolo?: string
    /** Campo 2 FIR: numero di colli. */
    numeroColli?: number
    descrizione?: string
    categoria?: string
    /** RECOVERY / DISPOSAL — categoria macro. */
    tipoOperazione?: string
    /** Campo 3 FIR: codice operazione R/D specifico. */
    codiceOperazione?: string
  }

  @ApiProperty({ example: 'tenant-uuid-transporter', description: 'ID trasportatore' })
  trasportatoreId: string

  @ApiProperty({ example: 'tenant-uuid-destination', description: 'ID destinatario' })
  destinatarioId: string

  @ApiPropertyOptional({ description: 'Snapshot anagrafico produttore (congelato alla creazione)' })
  produttore?: ParteFIR | null

  @ApiPropertyOptional({
    description: 'Snapshot anagrafico trasportatore (congelato alla creazione)',
  })
  trasportatore?: ParteFIR | null

  @ApiPropertyOptional({
    description: 'Snapshot anagrafico destinatario (congelato alla creazione)',
  })
  destinatario?: ParteFIR | null

  @ApiPropertyOptional({
    type: [TrasportatoreAggiuntivoResponse],
    description: 'Trasportatori aggiuntivi (tratte intermodali), ordinati per `ordine`',
  })
  trasportatoriAggiuntivi: TrasportatoreAggiuntivoResponse[]

  @ApiPropertyOptional({ description: 'Data presa in carico trasportatore' })
  dataPresaCarico: Date | null

  @ApiPropertyOptional({ description: 'Data consegna destinatario' })
  dataConsegna: Date | null

  @ApiPropertyOptional({
    example: 118,
    description: 'Peso effettivo rilevato alla destinazione (4ª copia)',
  })
  pesoEffettivo: number | null

  /** Campo 17 FIR (DM 59/2023): annotazioni libere. */
  @ApiPropertyOptional({ description: 'Campo 17 FIR: annotazioni libere' })
  annotazioni: string | null

  /** 4ª copia: data restituzione dal destinatario al produttore. */
  @ApiPropertyOptional({ description: '4ª copia: data restituzione dal destinatario' })
  fourthCopyReturnedAt: Date | null

  /** 4ª copia: note/esito del destinatario. */
  @ApiPropertyOptional({ description: '4ª copia: note/esito del destinatario' })
  fourthCopyNotes: string | null

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
        numeroColli: fir.rifiuto.numeroColli,
        descrizione: fir.rifiuto.descrizione,
        categoria: fir.rifiuto.categoria,
        tipoOperazione: fir.rifiuto.tipoOperazione,
        codiceOperazione: fir.rifiuto.codiceOperazione,
      },
      trasportatoreId: fir.trasportatoreId,
      destinatarioId: fir.destinatarioId,
      produttore: fir.produttore,
      trasportatore: fir.trasportatore,
      destinatario: fir.destinatario,
      trasportatoriAggiuntivi: (fir.trasportatoriAggiuntivi ?? []).map(t => ({
        ordine: t.ordine,
        tipoTratta: t.tipoTratta,
        denominazione: t.denominazione,
        partitaIva: t.partitaIva,
        codiceFiscale: t.codiceFiscale,
        numeroIscrizioneAlbo: t.numeroIscrizioneAlbo,
        mezzo: t.mezzo,
      })),
      dataPresaCarico: fir.dataPresaCarico,
      dataConsegna: fir.dataConsegna,
      pesoEffettivo: fir.pesoEffettivo,
      annotazioni: fir.annotazioni,
      fourthCopyReturnedAt: fir.fourthCopyReturnedAt,
      fourthCopyNotes: fir.fourthCopyNotes,
      createdAt: fir.createdAt,
    }
  }
}
