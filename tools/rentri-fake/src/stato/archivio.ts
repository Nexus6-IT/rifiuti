import { randomUUID } from 'crypto'

export interface Formulario {
  numero_fir: string
  stato: string
  produttore: string
}

export type StatoTransazione = 'in_elaborazione' | 'completata'

export interface Guasto {
  stato: number
  volte: number
}

/**
 * `EsitoMessaggioModel` (formulari.yaml righe 9446-9472): messaggio di
 * validazione allegato all'esito di una transazione.
 */
export interface EsitoMessaggio {
  indice?: number
  campo?: string
  tipo: 'Errore' | 'Avvertimento'
  codice_messaggio?: string
  parametri?: unknown[]
}

/**
 * Sottoinsieme di `EsitoFormularioModel` (formulari.yaml righe 9378-9414)
 * prodotto dal completamento di una transazione: conserva sempre `errore`
 * e `validazione`, i campi con cui il client distingue un esito negativo
 * da un successo. La fake precedente li ignorava del tutto.
 */
export interface EsitoTransazione {
  esito?: unknown
  tipo?: string
  validazione: EsitoMessaggio[]
  errore: boolean
  tempo_elaborazione?: string
}

export interface Transazione {
  id: string
  stato: StatoTransazione
  esito?: EsitoTransazione
}

/**
 * Stato in memoria della fake. Volutamente non persistente: ogni avvio
 * riparte pulito, così i test non dipendono dall'ordine di esecuzione.
 */
export class Archivio {
  private formulari = new Map<string, Formulario>()
  private transazioni = new Map<string, Transazione>()
  private guasto: Guasto | null = null

  azzera(): void {
    this.formulari.clear()
    this.transazioni.clear()
    this.guasto = null
  }

  impostaGuasto(guasto: Guasto | null): void {
    this.guasto = guasto
  }

  /**
   * Restituisce il guasto se ancora attivo e ne consuma un'occorrenza.
   */
  guastoAttivo(): Guasto | null {
    if (!this.guasto || this.guasto.volte <= 0) {
      return null
    }

    this.guasto.volte -= 1
    return this.guasto
  }

  salvaFormulario(formulario: Formulario): void {
    this.formulari.set(formulario.numero_fir, formulario)
  }

  leggiFormulario(numeroFir: string): Formulario | undefined {
    return this.formulari.get(numeroFir)
  }

  elencaFormulari(): Formulario[] {
    return [...this.formulari.values()]
  }

  /**
   * NONBLOCK_PULL: crea una transazione in stato `in_elaborazione` con
   * identificativo in formato uuid — `TransazioneModel.transazione_id` è
   * `format: uuid` (formulari.yaml righe 10276-10278), non un contatore
   * `TRX-000001` come nella fake precedente. La fake non la completa da
   * sola: il completamento arriva solo dal canale di controllo.
   */
  creaTransazione(): string {
    const id = randomUUID()
    this.transazioni.set(id, { id, stato: 'in_elaborazione' })
    return id
  }

  leggiTransazione(id: string): Transazione | undefined {
    return this.transazioni.get(id)
  }

  completaTransazione(id: string, esito: EsitoTransazione): void {
    const transazione = this.transazioni.get(id)
    if (!transazione) return
    transazione.stato = 'completata'
    transazione.esito = esito
  }
}
