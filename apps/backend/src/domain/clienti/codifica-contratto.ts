/**
 * Codifiche del contratto: categorie, tipi, motivi di annullo (D26, 4.1a): regole pure.
 *
 * Tre elenchi di codice + descrizione che WinWaste tiene in tabelle di categorie per tipo
 * (E25, E29), qui in una sola tabella con il `genere`. Il codice e' `[A-Za-z0-9]{1,3}`; se manca
 * (creazione in linea, come F4 di WinWaste) lo assegna il servizio con `primoCodiceLibero`:
 * il primo numerico libero `001`-`999` del genere, oltre il quale WinWaste dice "codice maggiore
 * di 999".
 */
import { validaCodiceTabella } from './codice-tabella'

export type GenereCodifica = 'CATEGORIA' | 'TIPO' | 'MOTIVO_ANNULLO'

export const ETICHETTE_GENERE: Readonly<Record<GenereCodifica, string>> = {
  CATEGORIA: 'Categoria',
  TIPO: 'Tipo di contratto',
  MOTIVO_ANNULLO: 'Motivo di annullo',
}

/** Codice vuoto in modifica: nel contratto il codice e' libero (alfanumerico), non serve dire altro. */
export const MSG_CODICE_MANCANTE_CONTRATTO = 'Indica il codice.'

export interface DatiCodifica {
  genere: GenereCodifica
  codice: string | null
  descrizione: string
}

export function normalizzaCodifica(g: Partial<Record<keyof DatiCodifica, unknown>>): DatiCodifica {
  const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const codice = testo(g.codice)
  return {
    genere: testo(g.genere).toUpperCase() as GenereCodifica,
    codice: codice === '' ? null : codice,
    descrizione: testo(g.descrizione),
  }
}

export function validaCodifica(d: DatiCodifica): string[] {
  const errori: string[] = []

  if (d.genere !== 'CATEGORIA' && d.genere !== 'TIPO' && d.genere !== 'MOTIVO_ANNULLO') {
    errori.push('Il genere della codifica non è ammesso.')
  }

  if (d.codice !== null) {
    const m = validaCodiceTabella(d.codice, 3, 'Il codice', '[A-Za-z0-9]')
    if (m) errori.push(m)
  }

  if (d.descrizione === '') errori.push('Indica la descrizione.')
  else if (d.descrizione.length > 60) {
    errori.push('La descrizione può avere al massimo 60 caratteri.')
  }

  return errori
}

/** Primo codice numerico libero da '001' a '999'; null se sono tutti usati. */
export function primoCodiceLibero(usati: readonly string[]): string | null {
  const occupati = new Set<number>()
  for (const c of usati) if (/^\d{1,3}$/.test(c)) occupati.add(Number(c))
  for (let n = 1; n <= 999; n++) {
    if (!occupati.has(n)) return String(n).padStart(3, '0')
  }
  return null
}
