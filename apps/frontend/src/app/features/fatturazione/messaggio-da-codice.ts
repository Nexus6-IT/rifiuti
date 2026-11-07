import { codiceErrore } from '../listino/errori-azione'
import { voceSegnalazione } from './vocabolario-fatturazione'

/**
 * Messaggio di un errore HTTP per le pagine dell'anteprima: l'etichetta del vocabolario se il
 * codice è noto, altrimenti il ripiego. Non mostra mai il testo libero del backend (può contenere
 * id o dettagli tecnici).
 */
export function messaggioDaCodice(err: unknown, ripiego: string): string {
  const codice = codiceErrore(err)
  if (codice !== null) {
    const voce = voceSegnalazione(codice)
    if (voce.etichetta !== codice) return voce.etichetta
  }
  return ripiego
}
