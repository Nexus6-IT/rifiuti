/**
 * Elenco dei soggetti che la fake riconosce come accreditati presso RENTRI
 * (FEDELTA.md §5.2 punto 4). Prima di questa correzione qualunque stringa
 * nel claim `sub` di un JWT altrimenti valido veniva accettata come
 * operatore esistente. In produzione RENTRI verifica l'iscrizione al
 * registro dei soggetti; qui usiamo un elenco statico e noto alla fake,
 * estendibile esplicitamente (mai implicitamente da un token che si
 * autodichiara).
 */
const soggettiAccreditati = new Set<string>(['operatore-test'])

export function soggettoAccreditato(identificativo: string): boolean {
  return soggettiAccreditati.has(identificativo)
}

/**
 * Accredita un nuovo soggetto: usato dai test per abilitare identificativi
 * diversi dal default `operatore-test`. In una fake reale potrebbe essere
 * esposto anche dal canale `__controllo`, ma non e' richiesto dal contratto.
 */
export function accreditaSoggetto(identificativo: string): void {
  soggettiAccreditati.add(identificativo)
}
