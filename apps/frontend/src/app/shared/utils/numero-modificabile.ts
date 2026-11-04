// Numeri nei campi MODIFICABILI di tutta l'app (decisione di Graziano, 02/11 per il listino,
// estesa il 03/11 a registro, giacenze, MUD, FIR, pese, admin, RENTRI): la virgola è l'unico
// separatore decimale, il punto è VIETATO (un punto dà l'errore «Usa la virgola per i decimali» e
// il form non si salva, oppure la direttiva `appNumeroIt` lo respinge sui `p-inputNumber`) e nei
// campi non compare mai il separatore delle migliaia (1000 si legge «1000», non «1.000»). Un solo
// parser e un solo formattatore. I totali di sola visualizzazione possono invece usare i punti
// delle migliaia (`decimaleItaliano`).
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms'

export const MSG_VIRGOLA = 'Usa la virgola per i decimali'
export const MSG_NUMERO = 'Numero non valido'

export interface EsitoNumero<T> {
  /** Il valore nella forma del backend (punto decimale); null se il campo è vuoto o errato. */
  valore: T | null
  errore: string | null
}

// Accetta anche `,5` e `5,`: mentre si scrive `1,5` il campo non deve segnalare l'errore appena
// dopo la virgola.
const DECIMALE = /^-?(\d+(,\d*)?|,\d+)$/
const INTERO = /^\d+$/
/** `12,5` → `12.5`, `,5` → `0.5`, `5,` → `5`. Il testo è già stato validato con `DECIMALE`. */
const conPunto = (t: string): string =>
  t
    .replace(',', '.')
    .replace(/^(-?)\./, (_m, segno: string) => `${segno}0.`)
    .replace(/\.$/, '')

const senzaSpazi = (t: string): string => t.replace(/\s+/g, '')

/** Decimale scritto con la virgola → decimale con il punto, per il backend. */
export function leggiNumero(testo: string): EsitoNumero<string> {
  const t = senzaSpazi(testo)
  if (t === '') return { valore: null, errore: null }
  if (t.includes('.')) return { valore: null, errore: MSG_VIRGOLA }
  if (!DECIMALE.test(t)) return { valore: null, errore: MSG_NUMERO }
  return { valore: conPunto(t), errore: null }
}

/** Cascata di percentuali (`10+5,5`): ogni termine come `leggiNumero`. */
export function leggiCascata(testo: string): EsitoNumero<string> {
  const t = senzaSpazi(testo)
  if (t === '') return { valore: null, errore: null }
  if (t.includes('.')) return { valore: null, errore: MSG_VIRGOLA }
  const termini = t.split('+')
  if (!termini.every(x => DECIMALE.test(x))) return { valore: null, errore: MSG_NUMERO }
  return { valore: termini.map(conPunto).join('+'), errore: null }
}

/** Messaggio della regola E10 sulle cascate di sconto (lo stesso del backend). */
export const MSG_CASCATA_SCONTO =
  'Le percentuali a cascata sono al massimo tre (es. 10+5), ciascuna fino a 99,99.'

/** Termine di una cascata come lo accetta il backend (`TERMINE_CASCATA`): `n`, `nn`, `n,n`, `nn,nn`. */
const TERMINE_SCONTO = /^\d{1,2}(\.\d{1,2})?$/

/**
 * Cascata di sconto come la accetta il backend (E10): al massimo tre termini, ciascuno da 0 a
 * 99,99, senza segno. Prima la forma (`leggiCascata`), poi i limiti: `-5`, `100`, `10,555` e
 * quattro termini sono errori qui, perché il backend risponderebbe 400 e la registrazione intera
 * non partirebbe.
 */
export function leggiScontoCascata(testo: string): EsitoNumero<string> {
  const lettura = leggiCascata(testo)
  if (lettura.errore !== null || lettura.valore === null) return lettura
  const termini = lettura.valore.split('+')
  if (termini.length > 3 || !termini.every(t => TERMINE_SCONTO.test(t))) {
    return { valore: null, errore: MSG_CASCATA_SCONTO }
  }
  return lettura
}

/** Intero senza segno: `1a` e `2026x` sono errori, non 1 e 2026. */
export function leggiIntero(testo: string): EsitoNumero<number> {
  const t = senzaSpazi(testo)
  if (t === '') return { valore: null, errore: null }
  if (t.includes('.') || t.includes(',')) return { valore: null, errore: MSG_NUMERO }
  if (!INTERO.test(t)) return { valore: null, errore: MSG_NUMERO }
  return { valore: Number.parseInt(t, 10), errore: null }
}

/**
 * Valore del backend → testo del campo: virgola, zeri decimali finali tolti fino a
 * `minimoDecimali` cifre, nessun separatore delle migliaia (`1000.00` → `1000`, con due decimali
 * minimi `1000,00`). Ciò che non è un decimale semplice resta com'è.
 */
export function formatNumero(v: string | null | undefined, minimoDecimali = 0): string {
  if (v === null || v === undefined) return ''
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim())
  if (!m) return v
  let dec = m[3] ?? ''
  while (dec.length > minimoDecimali && dec.endsWith('0')) dec = dec.slice(0, -1)
  dec = dec.padEnd(minimoDecimali, '0')
  return `${m[1]}${m[2]}${dec ? ',' + dec : ''}`
}

/** Cascata del backend (`12.5+5`) → testo del campo (`12,5+5`). */
export function formatCascata(v: string | null | undefined): string {
  return v === null || v === undefined ? '' : v.replace(/\./g, ',')
}

/** Validatore dei form reattivi: l'errore `numero` porta il messaggio da mostrare. */
export function validatoreNumero(tipo: 'decimale' | 'cascata' | 'intero'): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const t = String(c.value ?? '')
    const e =
      tipo === 'decimale'
        ? leggiNumero(t).errore
        : tipo === 'cascata'
          ? leggiCascata(t).errore
          : leggiIntero(t).errore
    return e === null ? null : { numero: e }
  }
}

/** Messaggio dell'errore `numero` del controllo (nessuna condizione su `touched`), o null. */
export function messaggioNumero(c: AbstractControl | null | undefined): string | null {
  const e = c?.errors?.['numero']
  return typeof e === 'string' ? e : null
}
