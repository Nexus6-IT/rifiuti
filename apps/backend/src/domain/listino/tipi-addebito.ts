/**
 * Tipi di addebito (4.2a, D5, E5): funzioni pure, senza database.
 *
 * Forme ammesse: `CER`, `V`, `F`, `TS|TP|TR|TQ|TT|TF`, `T` + 3 cifre (categoria), `NM|NP|NG|NR`,
 * `MF|MW`, `M` + 3 cifre (minimo per categoria), `$A|$D|$R`. Il `???` dei modelli (`T???`,
 * `M???`) si valida solo per forma, non contro le categorie esistenti.
 */

export type TipoAddebito = string

export type FamigliaAddebito =
  | 'CER'
  | 'VARIABILE'
  | 'FISSO'
  | 'QUANTITA_MOVIMENTI'
  | 'CONTEGGIO'
  | 'MINIMO'
  | 'ACCONTO'

const FORMA_TIPO = /^(CER|V|F|T[SPRQTF]|T\d{3}|N[MPGR]|M[FW]|M\d{3}|\$[ADR])$/

const ERRORE_TIPO = 'Il tipo di addebito non è ammesso.'

/** Etichette dei tipi a forma fissa. `???` e' sostituito con la categoria nei tipi `T…`/`M…`. */
const ETICHETTE_FISSE: Readonly<Record<string, string>> = {
  CER: 'Riga CER',
  V: 'La quantità va specificata in immissione documento',
  F: 'Importo fisso periodico',
  TS: 'Peso netto dei rifiuti speciali del presente elenco',
  TP: 'Peso netto dei rifiuti pericolosi del presente elenco',
  TR: 'Peso netto dei rifiuti urbani del presente elenco',
  TQ: 'Peso netto dei rifiuti urbani pericolosi del presente elenco',
  TT: 'Peso netto di tutti i rifiuti del presente elenco',
  TF: 'Peso netto dei rifiuti conferiti in giorni festivi del presente elenco',
  NM: 'Numero dei movimenti relativi al presente elenco addebiti',
  NP: 'Numero dei movimenti con peso netto non nullo relativi al presente elenco addebiti',
  NG: 'Numero dei giorni movimentati relativi al presente elenco addebiti',
  NR: 'Numero dei giorni del periodo di riferimento della fattura',
  MF: "Sostituisce le righe CER a prezzo normale in fattura se l'importo è inferiore",
  MW: "Se l'imponibile degli addebiti a prezzo normale è inferiore aggiunge la differenza",
  $A: 'Acconto da inserire nella prossima fattura e da detrarre dalla successiva',
  $D: 'Detrazione da applicare alla prossima fattura',
  $R: 'Anticipo da detrarre dal totale a pagare della prossima fattura',
}

export function tipoAddebitoValido(t: string): boolean {
  return FORMA_TIPO.test(t)
}

export function famigliaTipo(t: string): FamigliaAddebito {
  if (!tipoAddebitoValido(t)) throw new Error(ERRORE_TIPO)
  if (t === 'CER') return 'CER'
  if (t === 'V') return 'VARIABILE'
  if (t === 'F') return 'FISSO'
  switch (t[0]) {
    case 'T':
      return 'QUANTITA_MOVIMENTI'
    case 'N':
      return 'CONTEGGIO'
    case 'M':
      return 'MINIMO'
    default:
      return 'ACCONTO'
  }
}

/** Etichetta italiana del tipo; per `T123`/`M123` riporta la categoria, per i modelli `???`. */
export function etichettaTipo(t: string): string {
  if (!tipoAddebitoValido(t)) throw new Error(ERRORE_TIPO)
  const fissa = ETICHETTE_FISSE[t]
  if (fissa !== undefined) return fissa
  const categoria = t.slice(1)
  return t[0] === 'T'
    ? `Peso netto di tutti i rifiuti di cat. ${categoria} del presente elenco`
    : `Se l'imponibile degli addebiti di tipo V di cat. ${categoria} a prezzo normale è inferiore aggiunge la differenza`
}

/** Tipi proposti nei menu: i modelli `T???` e `M???` stanno per ogni categoria; `CER` e' escluso. */
export const TIPI_ELENCABILI: readonly { tipo: string; etichetta: string }[] = [
  'V',
  'F',
  'TS',
  'TP',
  'TR',
  'TQ',
  'TT',
  'TF',
  'T???',
  'NM',
  'NP',
  'NG',
  'NR',
  'MF',
  'MW',
  'M???',
  '$A',
  '$D',
  '$R',
].map(tipo => ({
  tipo,
  etichetta: etichettaTipo(tipo.replace('???', '000')).replace('000', '???'),
}))

/** Nell'archivio addebiti sono ammessi tutti i tipi tranne `CER` (che sta solo nelle righe). */
export function tipoAmmessoInArchivio(t: string): boolean {
  return tipoAddebitoValido(t) && t !== 'CER'
}

/** In un contratto allegato solo addebiti di tipo `T…` (D17). */
export function tipoAmmessoInAllegato(t: string): boolean {
  return tipoAddebitoValido(t) && t[0] === 'T'
}
