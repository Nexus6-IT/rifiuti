/**
 * Quando un rapporto di riconciliazione si puo' chiudere (piano import 3.6, I8): tutti i confronti
 * `OK`, oppure ogni differenza accettata una per una con un motivo; il campione a mano tutto
 * confrontato con esito positivo. Una differenza del campione non si accetta: si corregge i dati.
 */
import { chiaveDifferenza, EsitiRiconciliazione } from './tipi'

export type EsitoCampione = 'CORRISPONDE' | 'NON_CORRISPONDE'

export interface StatoCampioni {
  readonly totale: number
  readonly senzaEsito: number
  readonly nonCorrispondono: number
}

export interface ValutazioneChiusura {
  readonly chiudibile: boolean
  /** Voci `DIFFERENZA` senza accettazione, nella forma `<confronto>:<chiave>`. */
  readonly differenzeAperte: readonly string[]
  readonly campioniSenzaEsito: number
  readonly campioniNonCorrispondono: number
}

export const MOTIVO_MINIMO = 5
export const MOTIVO_MASSIMO = 500

export function valutaChiusura(
  esiti: Pick<EsitiRiconciliazione, 'confronti' | 'accettazioni'>,
  campioni: StatoCampioni
): ValutazioneChiusura {
  const differenzeAperte: string[] = []
  for (const c of esiti.confronti)
    for (const v of c.voci) {
      if (v.esito !== 'DIFFERENZA') continue
      const k = chiaveDifferenza(c.numero, v.chiave)
      if (!esiti.accettazioni[k]) differenzeAperte.push(k)
    }
  return {
    chiudibile:
      differenzeAperte.length === 0 && campioni.senzaEsito === 0 && campioni.nonCorrispondono === 0,
    differenzeAperte,
    campioniSenzaEsito: campioni.senzaEsito,
    campioniNonCorrispondono: campioni.nonCorrispondono,
  }
}

/** Motivo ripulito, o `null` se non e' un testo ragionevole. */
export function motivoValido(motivo: unknown): string | null {
  if (typeof motivo !== 'string') return null
  const t = motivo.trim()
  return t.length >= MOTIVO_MINIMO && t.length <= MOTIVO_MASSIMO ? t : null
}
