/**
 * Spese accessorie: spese di incasso e bollo (D23, 4.1a): regole pure.
 *
 * Una sola tabella per i due tipi della tabella `[SPESE]` di WinWaste (E18): `INCASSO`
 * ("spese bancarie", `S`) e `BOLLO` ("bollo su esenzione", `E`). L'importo e' una stringa
 * decimale (max 8 cifre intere, 2 decimali), mai `number`.
 *
 * Resta a 4.4, che ha la tabella IVA e il piano dei conti: aliquota IVA, natura e contropartita.
 */
import { validaCodiceTabella } from './codice-tabella'
import { decimaleValido, normalizzaDecimale } from './decimali'

export type TipoSpesa = 'INCASSO' | 'BOLLO'

export const ETICHETTE_TIPO_SPESA: Readonly<Record<TipoSpesa, string>> = {
  INCASSO: 'Spese di incasso',
  BOLLO: 'Bollo',
}

export interface DatiSpesaAccessoria {
  tipo: TipoSpesa
  codice: string
  descrizione: string
  importo: string
}

export function normalizzaSpesa(
  g: Partial<Record<keyof DatiSpesaAccessoria, unknown>>
): DatiSpesaAccessoria {
  const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  return {
    tipo: testo(g.tipo).toUpperCase() as TipoSpesa,
    codice: testo(g.codice),
    descrizione: testo(g.descrizione),
    importo: normalizzaDecimale(g.importo) ?? '',
  }
}

export function validaSpesa(d: DatiSpesaAccessoria): string[] {
  const errori: string[] = []

  if (d.tipo !== 'INCASSO' && d.tipo !== 'BOLLO') errori.push('Il tipo di spesa non è ammesso.')

  const mCodice = validaCodiceTabella(d.codice, 10, 'Il codice')
  if (mCodice) errori.push(mCodice)

  if (d.descrizione === '') errori.push('Indica la descrizione.')
  else if (d.descrizione.length > 100) {
    errori.push('La descrizione può avere al massimo 100 caratteri.')
  }

  if (!decimaleValido(d.importo, 8)) {
    errori.push("L'importo deve essere un numero non negativo con al massimo due decimali.")
  }

  return errori
}
