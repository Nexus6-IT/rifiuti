import { Injectable } from '@nestjs/common'

/** Finestra di conteggio dei token rifiutati. */
export const FINESTRA_FALLIMENTI_MS = 60_000
/** Token rifiutati o ignoti tollerati da uno stesso IP in una finestra, poi 429 fino a fine finestra. */
export const LIMITE_FALLIMENTI_PER_IP = 30
/** Tetto alle voci in memoria: oltre, si scartano le scadute e, se serve, le piu' vecchie. */
const MAX_VOCI = 10_000

interface Voce {
  inizio: number
  conteggio: number
}

/**
 * Tetto d'ingresso PRIMA dell'autenticazione (review B4-B7, I1): conta per IP SOLO le richieste
 * con token ignoto, malformato o non ancora abbinato. Le richieste autenticate non pagano nulla,
 * quindi un attaccante che spedisce token casuali blocca il proprio IP e non gli altri agenti.
 * Richiede `trust proxy` (v. `valoreTrustProxy`), altrimenti `req.ip` e' quello di nginx.
 * In memoria: con piu' processi `backend` va spostato su Redis (rischio R6).
 */
@Injectable()
export class FallimentiAutenticazione {
  private readonly voci = new Map<string, Voce>()

  // Proprieta' e non parametri del costruttore: Nest tenterebbe di iniettare `Number`.
  limite = LIMITE_FALLIMENTI_PER_IP
  finestraMs = FINESTRA_FALLIMENTI_MS

  /** Per i test: tetto e finestra diversi dai predefiniti. */
  static con(limite: number, finestraMs: number): FallimentiAutenticazione {
    return Object.assign(new FallimentiAutenticazione(), { limite, finestraMs })
  }

  /** Secondi al termine del blocco se l'IP ha esaurito il tetto, altrimenti `null`. */
  bloccatoPer(ip: string, adesso = Date.now()): number | null {
    const v = this.voci.get(ip)
    if (!v || adesso - v.inizio >= this.finestraMs) return null
    if (v.conteggio < this.limite) return null
    return Math.max(1, Math.ceil((v.inizio + this.finestraMs - adesso) / 1000))
  }

  /** Registra un token rifiutato da questo IP. */
  registra(ip: string, adesso = Date.now()): void {
    const v = this.voci.get(ip)
    if (!v || adesso - v.inizio >= this.finestraMs) {
      if (this.voci.size >= MAX_VOCI) this.pulisci(adesso)
      this.voci.set(ip, { inizio: adesso, conteggio: 1 })
      return
    }
    v.conteggio += 1
  }

  private pulisci(adesso: number): void {
    for (const [ip, v] of this.voci) {
      if (adesso - v.inizio >= this.finestraMs) this.voci.delete(ip)
    }
    // Ancora piena (attacco da molti IP): si scarta la meta' piu' vecchia, l'ordine e' di inserimento.
    if (this.voci.size >= MAX_VOCI) {
      let da = this.voci.size / 2
      for (const ip of this.voci.keys()) {
        if (da-- <= 0) break
        this.voci.delete(ip)
      }
    }
  }
}
