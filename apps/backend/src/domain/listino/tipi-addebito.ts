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
  V: 'Variabile (quantità indicata nel documento)',
  F: 'Fisso periodico',
  TS: 'Peso netto totale del presente elenco',
  TP: 'Peso netto dei movimenti pesati del presente elenco',
  TR: 'Peso netto dei movimenti ritirati del presente elenco',
  TQ: 'Peso netto dei movimenti a quantità del presente elenco',
  TT: 'Peso netto dei movimenti a tonnellate del presente elenco',
  TF: 'Peso netto dei movimenti festivi del presente elenco',
  NM: 'Conteggio dei movimenti del presente elenco',
  NP: 'Conteggio dei movimenti pesati del presente elenco',
  NG: 'Conteggio dei giorni di movimento del presente elenco',
  NR: 'Conteggio dei ritiri del presente elenco',
  MF: 'Minimo fisso',
  MW: 'Minimo sul peso',
  $A: 'Acconto',
  $D: 'Detrazione',
  $R: 'Anticipo',
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
    ? `Peso netto di cat. ${categoria} del presente elenco`
    : `Minimo di cat. ${categoria} del presente elenco`
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
