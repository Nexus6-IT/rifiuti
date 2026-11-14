/**
 * Tabella CER → prodotti CONOU ammessi (`A B C E G`), dall'`OLIOtiporif` di WinWaste
 * (`ComunicazioneCou2023:631-711`, 64 CER). In WinWaste e' definita e mai usata; qui valida il
 * prodotto e propone il predefinito (difetto di WinWaste corretto, piano 4.9c-f «Difetti» §4).
 */
// INFERENZA (WinWaste, 14/11): le lettere sono quelle di WinWaste, non verificate sul manuale CONOU.
const TABELLA: Readonly<Record<string, string>> = {
  '050103': 'C',
  '070201': 'C',
  '080319': 'AB',
  '100211': 'C',
  '100327': 'C',
  '100409': 'C',
  '100508': 'C',
  '100609': 'C',
  '100707': 'C',
  '100819': 'C',
  '110111': 'CEG',
  '110112': 'CEG',
  '110113': 'CEG',
  '120106': 'ABE',
  '120107': 'AB',
  '120108': 'C',
  '120109': 'C',
  '120110': 'AB',
  '120112': 'C',
  '120119': 'AB',
  '120301': 'C',
  '120302': 'C',
  '130101': 'EAB',
  '130104': 'C',
  '130105': 'C',
  '130109': 'AB',
  '130110': 'AB',
  '130111': 'AB',
  '130112': 'AB',
  '130113': 'AB',
  '130204': 'AG',
  '130205': 'A',
  '130206': 'A',
  '130207': 'A',
  '130208': 'AG',
  '130301': 'ABEG',
  '130306': 'AB',
  '130307': 'AB',
  '130308': 'AB',
  '130309': 'AB',
  '130310': 'AB',
  '130401': 'AC',
  '130402': 'CE',
  '130403': 'AC',
  '130501': 'C',
  '130502': 'C',
  '130503': 'C',
  '130506': 'ABC',
  '130507': 'C',
  '130508': 'ABC',
  '130701': 'C',
  '130702': 'C',
  '130703': 'C',
  '130801': 'C',
  '130802': 'C',
  '130899': 'C',
  '160113': 'ABCEG',
  '160708': 'C',
  '160709': 'C',
  '161001': 'C',
  '161003': 'C',
  '190204': 'C',
  '190207': 'ABC',
  '190810': 'AC',
  '200126': 'AB',
}

export type ProdottoConou = 'A' | 'B' | 'C' | 'E' | 'G'
export const PRODOTTI_CONOU: readonly ProdottoConou[] = ['A', 'B', 'C', 'E', 'G']

/** Solo le cifre del CER (`13 02 05*` → `130205`). */
function cifre(cer: string): string {
  return cer.replace(/\D/g, '')
}

/** Numero di CER della tabella (64 in WinWaste). */
export const NUMERO_CER_TABELLA_CONOU = Object.keys(TABELLA).length

/** Prodotti ammessi per il CER, ordinati; lista vuota se il CER non e' in tabella. */
export function prodottiAmmessiPerCer(cer: string): ProdottoConou[] {
  const lettere = TABELLA[cifre(cer)]
  if (!lettere) return []
  return [...new Set(lettere.split(''))].sort() as ProdottoConou[]
}

/** Il prodotto predefinito: quello unico ammesso per il CER, altrimenti `null`. */
export function prodottoPredefinito(cer: string): ProdottoConou | null {
  const ammessi = prodottiAmmessiPerCer(cer)
  return ammessi.length === 1 ? ammessi[0] : null
}
