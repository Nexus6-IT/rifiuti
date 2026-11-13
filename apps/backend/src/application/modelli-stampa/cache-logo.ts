/**
 * Cache in memoria dei loghi dei modelli di stampa. Il logo (fino a 256 KiB, base64 in colonna
 * `text`) non cambia quasi mai ma si rileggeva a ogni stampa o apertura della lista.
 *
 * Isolamento: la chiave contiene SEMPRE l'azienda (`tenantId`) oltre a modello e `versione`; un
 * modello di un'altra azienda non puo' mai trovare la voce di questa, nemmeno con lo stesso id.
 * Invalidazione: `versione` sale a ogni modifica, quindi una voce vecchia non viene piu' trovata
 * neanche dalle altre istanze del backend; in piu' `invalida` la toglie subito su questa istanza e
 * il TTL ripulisce quel che resta. Tetti: numero di voci e byte totali (si espelle la meno usata).
 */
export interface OpzioniCacheLogo {
  maxVoci: number
  maxCaratteri: number
  ttlMs: number
  adesso?: () => number
}

interface Voce {
  logo: string | null
  scade: number
}

export class CacheLogo {
  private readonly voci = new Map<string, Voce>() // ordine di inserimento = dal meno al piu' recente
  private caratteri = 0
  private readonly adesso: () => number

  constructor(private readonly opzioni: OpzioniCacheLogo) {
    this.adesso = opzioni.adesso ?? Date.now
  }

  private static chiave(tenantId: string, modelloId: string, versione: number): string {
    return `${tenantId}|${modelloId}|${versione}`
  }

  /** `undefined` = non in cache; `null` = in cache, il modello non ha logo. */
  get(tenantId: string, modelloId: string, versione: number): string | null | undefined {
    const k = CacheLogo.chiave(tenantId, modelloId, versione)
    const voce = this.voci.get(k)
    if (!voce) return undefined
    if (voce.scade <= this.adesso()) {
      this.togli(k)
      return undefined
    }
    // Usata di recente: in fondo all'ordine.
    this.voci.delete(k)
    this.voci.set(k, voce)
    return voce.logo
  }

  set(tenantId: string, modelloId: string, versione: number, logo: string | null): void {
    const k = CacheLogo.chiave(tenantId, modelloId, versione)
    this.togli(k)
    // Un logo da solo oltre il tetto non si tiene.
    if ((logo?.length ?? 0) > this.opzioni.maxCaratteri) return
    this.voci.set(k, { logo, scade: this.adesso() + this.opzioni.ttlMs })
    this.caratteri += logo?.length ?? 0
    while (this.voci.size > this.opzioni.maxVoci || this.caratteri > this.opzioni.maxCaratteri) {
      const piuVecchia = this.voci.keys().next().value as string | undefined
      if (piuVecchia === undefined) break
      this.togli(piuVecchia)
    }
  }

  /** Toglie tutte le versioni di un modello di quell'azienda. */
  invalida(tenantId: string, modelloId: string): void {
    const prefisso = `${tenantId}|${modelloId}|`
    for (const k of [...this.voci.keys()]) if (k.startsWith(prefisso)) this.togli(k)
  }

  get dimensione(): number {
    return this.voci.size
  }

  private togli(k: string): void {
    const voce = this.voci.get(k)
    if (!voce) return
    this.caratteri -= voce.logo?.length ?? 0
    this.voci.delete(k)
  }
}
