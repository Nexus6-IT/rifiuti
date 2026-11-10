/**
 * Contratto di un tracciato di comunicazione a un consorzio o osservatorio, e registro dei
 * tracciati disponibili (sul modello di `application/mud/export/mud-version.registry.ts`, ma puro).
 */
export interface TracciatoComunicazione<D = unknown> {
  /** Chiave del consorzio/osservatorio, es. `ORSO`. */
  readonly consorzio: string
  /** Versione del tracciato, es. `ImpiantoMesi-1`. */
  readonly versione: string
  /** Estensione del file prodotto, senza punto. */
  readonly estensione: string
  /** Tipo MIME del file prodotto. */
  readonly contentType: string
  /** Errori bloccanti dei dati rispetto al tracciato; lista vuota se serializzabili. */
  validaDati(dati: D): string[]
  /** Produce il contenuto del file. Lancia se `validaDati` non è vuota. */
  serializza(dati: D): string
}

export class RegistroTracciati {
  private readonly tracciati = new Map<string, TracciatoComunicazione<never>>()

  private static chiave(consorzio: string, versione: string): string {
    return `${consorzio}\u0000${versione}`
  }

  registra<D>(tracciato: TracciatoComunicazione<D>): this {
    const k = RegistroTracciati.chiave(tracciato.consorzio, tracciato.versione)
    if (this.tracciati.has(k)) {
      throw new Error(`Tracciato già registrato: ${tracciato.consorzio} ${tracciato.versione}`)
    }
    this.tracciati.set(k, tracciato as unknown as TracciatoComunicazione<never>)
    return this
  }

  /** Tracciato esatto; lancia se non esiste. Il tipo dei dati lo sceglie il chiamante. */
  get<D = unknown>(consorzio: string, versione: string): TracciatoComunicazione<D> {
    const t = this.tracciati.get(RegistroTracciati.chiave(consorzio, versione))
    if (!t) throw new Error(`Tracciato non disponibile: ${consorzio} ${versione}`)
    return t as unknown as TracciatoComunicazione<D>
  }

  /** Versioni registrate per un consorzio, nell'ordine di registrazione. */
  versioni(consorzio: string): string[] {
    return [...this.tracciati.values()].filter(t => t.consorzio === consorzio).map(t => t.versione)
  }
}
