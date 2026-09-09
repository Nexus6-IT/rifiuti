import { Injectable } from '@nestjs/common'

import { HealthItem, formattaDurata, valutaRitardo } from '../health-item'

/**
 * Probe della freschezza dei dati prodotti dal sistema.
 *
 * DISTINZIONE CHE DECIDE QUESTA PROBE: non tutto cio' che e' «vecchio» e'
 * rotto. Un backup che manca da tre giorni e' un guasto, perche' esiste una
 * cadenza attesa e qualcuno ha promesso di rispettarla; l'ultimo FIR emesso
 * tre giorni fa non lo e' — puo' essere semplicemente un fine settimana.
 *
 * Le due cose non possono quindi avere lo stesso stato: una misura con
 * cadenza attesa viene valutata (`ok`/`warn`/`error`), una senza viene
 * mostrata come `info` — un numero che serve a chi legge, senza fingere un
 * giudizio che nessuno puo' dare.
 */
export interface MisuraFreschezza {
  key: string
  label: string
  ultimo: Date | null
  /** Cosa e' l'evento misurato, per la frase di prova. */
  descrizioneEvento: string
  /** Presente SOLO quando esiste una cadenza attesa da rispettare. */
  cadenzaAttesaMs?: number
  /** Sostituisce lo stato quando la misura e' spenta di proposito. */
  spenta?: { motivo: string }
}

@Injectable()
export class FreschezzaProbe {
  raccogli(misure: MisuraFreschezza[]): HealthItem[] {
    return misure.map(misura => this.valuta(misura))
  }

  private valuta(misura: MisuraFreschezza): HealthItem {
    const base = { key: `freschezza.${misura.key}`, label: misura.label }

    if (misura.spenta) {
      return { ...base, state: 'off', since: null, detail: misura.spenta.motivo }
    }

    if (misura.cadenzaAttesaMs) {
      const esito = valutaRitardo({
        ultimo: misura.ultimo,
        cadenzaAttesaMs: misura.cadenzaAttesaMs,
        descrizioneEvento: misura.descrizioneEvento,
      })
      return { ...base, state: esito.state, since: esito.since, detail: esito.detail }
    }

    if (!misura.ultimo) {
      return {
        ...base,
        state: 'unknown',
        since: null,
        detail: `Nessun ${misura.descrizioneEvento} registrato: non misurabile.`,
      }
    }

    return {
      ...base,
      state: 'info',
      since: misura.ultimo.toISOString(),
      detail: `${misura.descrizioneEvento} ${formattaDurata(
        Date.now() - misura.ultimo.getTime()
      )} fa. Nessuna cadenza attesa: valore descrittivo, non un giudizio.`,
    }
  }
}
