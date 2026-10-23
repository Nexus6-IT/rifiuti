/**
 * FIR Response DTO - API output
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { FIR, FIRStato, ParteFIR, TipoTratta } from '../../../domain/fir/aggregates/fir.aggregate'
import {
  traduciErroreRentri,
  RentriAzioneUtente,
} from '../../../application/rentri/rentri-error-presentation'

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

  /**
   * Data della presa in carico solo se registrata davvero in WasteFlow: la firma del
   * trasportatore la scrive soltanto `FIR.presaInCarico`, insieme alla data. Senza firma
   * `dataPresaCarico` è il ripiego `new Date()` del primo salvataggio (Decisione 10).
   */
  @ApiPropertyOptional({
    description:
      'Data della presa in carico registrata in WasteFlow (con firma del trasportatore); null se non è nota',
  })
  dataPresaCaricoEffettiva: Date | null

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

  /**
   * Stato RENTRI esposto nella lista formulari (R1 Task 3): senza questo
   * gruppo di campi l'operatore dovrebbe uscire dall'applicativo per sapere
   * se un FIR è a posto con l'ente — esattamente ciò che il criterio di
   * valore del task vieta.
   */
  @ApiProperty({
    enum: ['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'PERMANENTLY_FAILED'],
    example: 'PENDING',
    description: 'Stato di sincronizzazione RENTRI',
  })
  rentriSyncStatus: string

  @ApiPropertyOptional({
    example: 'RENTRI-000123',
    description: 'Numero FIR ufficiale RENTRI (legame confermato)',
  })
  rentriNumeroFir: string | null

  @ApiPropertyOptional({
    example: 'Annullato',
    description: "Stato del formulario all'ente RENTRI (ultimo noto), se acquisito",
  })
  rentriStatoFormulario: string | null

  @ApiPropertyOptional({
    example: 'RENTRI-000123',
    description:
      'Numero FIR proposto in modalità ibrida, in attesa di conferma esplicita: NON è ancora il legame ufficiale',
  })
  rentriNumeroFirProposto: string | null

  @ApiPropertyOptional({
    enum: ['TRASMESSO_DA_NOI', 'ACQUISITO_DA_TERZI', 'AGGANCIO_MANUALE'],
    description: 'Come è nato il legame con rentriNumeroFir',
  })
  rentriOrigineLegame: string | null

  @ApiPropertyOptional({
    description:
      "Ultimo messaggio di errore dell'ultima trasmissione fallita (tecnico — v. rentriMessaggioErrore per il testo da mostrare all'utente)",
  })
  rentriLastSyncError: string | null

  /**
   * Traduzione azionabile dell'ultimo fallimento (R1 Task 5): mai un codice
   * («403», «RENTRI_MISSING_NUMERO_FIR») o il ProblemDetails grezzo davanti
   * all'utente — v. `traduciErroreRentri`. `null` se non c'è un fallimento
   * da mostrare (nessuna trasmissione tentata, o ultimo esito positivo).
   */
  @ApiPropertyOptional({
    description: "Messaggio azionabile dell'ultimo fallimento, pronto per l'utente",
  })
  rentriMessaggioErrore: string | null

  @ApiPropertyOptional({
    enum: ['RIPROVA', 'VEDI_CERTIFICATO', 'NESSUNA', 'VERIFICA_SU_RENTRI', 'RILEGGI_ESITO'],
    description:
      "Azione proposta per l'ultimo fallimento: RIPROVA abilita il pulsante «Riprova», " +
      'VEDI_CERTIFICATO rimanda alla pagina del certificato, NESSUNA nasconde qualunque azione manuale, ' +
      'RILEGGI_ESITO propone «Rileggi esito» (nessun nuovo formulario)',
  })
  rentriAzioneErrore: RentriAzioneUtente | null

  @ApiProperty({ example: 0, description: 'Numero di tentativi di trasmissione effettuati' })
  rentriSyncAttempts: number

  @ApiProperty({
    description:
      'Se true, il FIR può essere trasmesso ora a RENTRI (stato emesso, non già legato, nessun fallimento permanente)',
  })
  canSyncToRENTRI: boolean

  static fromDomain(fir: FIR): FIRResponseDto {
    const lastError = fir.rentriSyncStatus.getLastError()
    // Nessun fallimento da tradurre: niente messaggio, niente azione.
    const erroreTradotto = lastError
      ? traduciErroreRentri({
          errorCode: fir.rentriSyncStatus.getLastErrorCode(),
          errorMessage: lastError,
        })
      : null

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
      dataPresaCaricoEffettiva: fir.firme.trasportatore ? fir.dataPresaCarico : null,
      dataConsegna: fir.dataConsegna,
      pesoEffettivo: fir.pesoEffettivo,
      annotazioni: fir.annotazioni,
      fourthCopyReturnedAt: fir.fourthCopyReturnedAt,
      fourthCopyNotes: fir.fourthCopyNotes,
      createdAt: fir.createdAt,
      rentriSyncStatus: fir.rentriSyncStatus.getStatus(),
      rentriNumeroFir: fir.rentriNumeroFir,
      rentriStatoFormulario: fir.rentriStatoFormulario,
      rentriNumeroFirProposto: fir.rentriNumeroFirProposto,
      rentriOrigineLegame: fir.rentriOrigineLegame,
      rentriLastSyncError: lastError ?? null,
      rentriMessaggioErrore: erroreTradotto?.messaggio ?? null,
      rentriAzioneErrore: erroreTradotto?.azione ?? null,
      rentriSyncAttempts: fir.rentriSyncStatus.getAttempts(),
      canSyncToRENTRI: fir.canSyncToRENTRI(),
    }
  }
}
