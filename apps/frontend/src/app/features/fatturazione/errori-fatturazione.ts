import { codiceErrore, leggiErroriAzione } from '../listino/errori-azione'
import { voceSegnalazione } from './vocabolario-fatturazione'

/**
 * Messaggi di un errore HTTP della fatturazione. Un codice di dominio noto al vocabolario dà la
 * sua etichetta (mai id o dati personali); altrimenti si legge `error.error.message` (stringa o
 * array) con il ripiego di `leggiErroriAzione`.
 */
export function messaggiErroreFatturazione(err: unknown, ripiego: string): string[] {
  const codice = codiceErrore(err)
  if (codice !== null) {
    const voce = voceSegnalazione(codice)
    if (voce.etichetta !== codice) return [voce.etichetta]
  }
  return leggiErroriAzione(err, ripiego).messaggi
}
