/**
 * Pattern del `numero_fir` come dichiarato dal contratto ufficiale
 * (`docs/contracts/rentri/formulari.yaml`, es. riga 299): 4-6 consonanti
 * ammesse (l'alfabeto RENTRI esclude le vocali per evitare ambiguità di
 * lettura), seguite dal progressivo numerico ed eventualmente da un
 * suffisso di 1-2 consonanti. La fake precedente non applicava alcun
 * vincolo di formato e restituiva 404 anche per stringhe palesemente mal
 * formate, dove il contratto prescrive 400.
 */
export const PATTERN_NUMERO_FIR =
  /^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$/

export function numeroFirValido(valore: string): boolean {
  return PATTERN_NUMERO_FIR.test(valore)
}
