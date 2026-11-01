/**
 * Codici IVA delle vendite (4.2a, D3): regole pure.
 *
 * Il codice e' quello di `[ESENZIONI]` di WinWaste ("22", "10", "N61"...): da 1 a 3 lettere o
 * cifre. L'aliquota e' una stringa decimale 0-100 con al massimo due decimali, mai `number`.
 *
 * FatturaPA: con aliquota zero l'elemento `Natura` e' obbligatorio, con aliquota diversa da zero
 * e' vietato. Si ammettono solo i valori con il dettaglio (N2.1, N3.2...): le nature generiche
 * `N2` e `N3` sono state scartate dallo SDI dal 2021, quindi non si accettano.
 *
 * Solo vendite: il codice di IVA indetraibile di WinWaste (E8) non si porta, perche' nella
 * fattura attiva non esiste una quota indetraibile da esporre.
 */
import { validaCodiceTabella } from '../clienti/codice-tabella'
import { decimaleValido, normalizzaDecimale } from '../clienti/decimali'

export const NATURE_IVA: readonly string[] = [
  'N1',
  'N2.1',
  'N2.2',
  'N3.1',
  'N3.2',
  'N3.3',
  'N3.4',
  'N3.5',
  'N3.6',
  'N4',
  'N5',
  'N6.1',
  'N6.2',
  'N6.3',
  'N6.4',
  'N6.5',
  'N6.6',
  'N6.7',
  'N6.8',
  'N6.9',
  'N7',
]

export interface DatiCodiceIva {
  codice: string
  descrizione: string
  /** Decimale a due cifre, es. "22.00". */
  aliquota: string
  natura: string | null
  attivo: boolean
}

const MAX_DESCRIZIONE = 60

export function normalizzaCodiceIva(
  g: Partial<Record<keyof DatiCodiceIva, unknown>>
): DatiCodiceIva {
  const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const natura = testo(g.natura).toUpperCase()
  return {
    codice: testo(g.codice),
    descrizione: testo(g.descrizione),
    aliquota: normalizzaDecimale(g.aliquota) ?? '',
    natura: natura === '' ? null : natura,
    attivo: !(g.attivo === false || g.attivo === 'false'),
  }
}

/** Errori nell'ordine dei campi: codice, descrizione, aliquota, natura. */
export function validaCodiceIva(d: DatiCodiceIva): string[] {
  const errori: string[] = []

  if (validaCodiceTabella(d.codice, 3, 'Il codice IVA', '[A-Za-z0-9]') !== null) {
    errori.push('Il codice IVA ha da 1 a 3 lettere o cifre.')
  }

  if (d.descrizione === '') errori.push('Indica la descrizione.')
  else if (d.descrizione.length > MAX_DESCRIZIONE) {
    errori.push(`La descrizione può avere al massimo ${MAX_DESCRIZIONE} caratteri.`)
  }

  const aliquotaValida = decimaleValido(d.aliquota, 3) && Number(d.aliquota) <= 100
  if (!aliquotaValida) {
    errori.push("L'aliquota deve essere un numero da 0 a 100 con al massimo due decimali.")
  }

  if (d.natura !== null && !NATURE_IVA.includes(d.natura)) {
    errori.push(
      'La natura indicata non è ammessa nella fattura elettronica (usa N1, N2.1-N2.2, N3.1-N3.6, N4, N5, N6.1-N6.9 o N7).'
    )
  } else if (aliquotaValida) {
    const zero = Number(d.aliquota) === 0
    if (zero && d.natura === null) {
      errori.push("Con aliquota zero indica la natura dell'operazione (N1-N7).")
    } else if (!zero && d.natura !== null) {
      errori.push('La natura si indica solo con aliquota zero.')
    }
  }

  return errori
}
