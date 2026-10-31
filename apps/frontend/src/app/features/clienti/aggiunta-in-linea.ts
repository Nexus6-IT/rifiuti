/**
 * Stato di un sub-dialog "Nuovo / Modifica" aperto da un form (schema di
 * contract-create-dialog.component.ts, scritto una volta). Nessun consumatore fino alla 4.1b.
 */
export class AggiuntaInLinea<T extends string> {
  aperto: T | null = null
  modalita: 'create' | 'edit' = 'create'
  elemento: unknown | null = null
  private origine: HTMLElement | null = null

  /** Apre il sub-dialog `chiave` e ricorda il pulsante da cui è partito. */
  apri(chiave: T, modalita: 'create' | 'edit', ev?: unknown, elemento?: unknown): void {
    const e = ev as Event | undefined
    const target = (e as MouseEvent | undefined)?.currentTarget ?? e?.target
    const el = target instanceof HTMLElement ? target : null
    this.origine = el?.closest('button') ?? el
    this.aperto = chiave
    this.modalita = modalita
    this.elemento = modalita === 'edit' ? (elemento ?? null) : null
  }

  /** Chiude e rende il focus al pulsante d'origine, dopo che PrimeNG ha tolto il dialog dal DOM. */
  chiudi(): void {
    const o = this.origine
    this.origine = null
    this.aperto = null
    this.elemento = null
    setTimeout(() => o?.isConnected && o.focus())
  }

  /**
   * Esc nel sub-dialog fa chiudere anche il dialog esterno (PrimeNG chiude ogni dialog con
   * closeOnEscape): true = si ignora la chiusura, o si perde il form compilato.
   */
  bloccaChiusuraEsterna(visibile: boolean): boolean {
    return !visibile && this.aperto !== null
  }

  /** Dopo il salvataggio: seleziona l'entità solo se il campo del form non è bloccato. */
  salvato<E extends { id: string }>(
    entita: E,
    applica: (id: string) => void,
    campoBloccato: boolean
  ): void {
    if (!campoBloccato) applica(entita.id)
  }
}
