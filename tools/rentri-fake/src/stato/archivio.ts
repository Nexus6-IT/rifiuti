export interface Formulario {
  numero_fir: string
  stato: string
  produttore: string
}

export type StatoTransazione = 'in_elaborazione' | 'completata' | 'fallita'

export interface Guasto {
  stato: number
  volte: number
}

export interface Transazione {
  id: string
  stato: StatoTransazione
  risultato?: unknown
}

/**
 * Stato in memoria della fake. Volutamente non persistente: ogni avvio
 * riparte pulito, così i test non dipendono dall'ordine di esecuzione.
 */
export class Archivio {
  private formulari = new Map<string, Formulario>()
  private transazioni = new Map<string, Transazione>()
  private contatore = 0
  private guasto: Guasto | null = null

  azzera(): void {
    this.formulari.clear()
    this.transazioni.clear()
    this.contatore = 0
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
   * NONBLOCK_PULL: crea una transazione in stato `in_elaborazione` e ne
   * restituisce l'identificativo. La fake non la completa da sola: il
   * completamento arriva solo dal canale di controllo (Task 8).
   */
  creaTransazione(): string {
    this.contatore += 1
    const id = `TRX-${String(this.contatore).padStart(6, '0')}`
    this.transazioni.set(id, { id, stato: 'in_elaborazione' })
    return id
  }

  leggiTransazione(id: string): Transazione | undefined {
    return this.transazioni.get(id)
  }

  completaTransazione(id: string, risultato: unknown): void {
    const transazione = this.transazioni.get(id)
    if (!transazione) return
    transazione.stato = 'completata'
    transazione.risultato = risultato
  }
}
