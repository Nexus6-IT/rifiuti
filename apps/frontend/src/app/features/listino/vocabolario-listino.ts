// Vocabolario del listino (4.2a, Task 12). Le etichette dei tipi di addebito, le famiglie e le
// nature IVA sono copiate da `apps/backend/src/domain/listino/{tipi-addebito,codice-iva}.ts`:
// quelle sono la fonte di verità, qui non si inventa niente. La tabella campo x famiglia (D9)
// arriva con il Task 26 (R16).
import { GenereCodificaAddebito, TipoProvvigione, TipoVariazione } from './listino.model'

export type FamigliaAddebito =
  | 'CER'
  | 'VARIABILE'
  | 'FISSO'
  | 'QUANTITA_MOVIMENTI'
  | 'CONTEGGIO'
  | 'MINIMO'
  | 'ACCONTO'

const FORMA_TIPO = /^(CER|V|F|T[SPRQTF]|T\d{3}|N[MPGR]|M[FW]|M\d{3}|\$[ADR])$/

/** Etichette dei tipi a forma fissa; `T…` e `M…` con tre cifre si compongono con la categoria. */
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
  if (!tipoAddebitoValido(t)) throw new Error('Il tipo di addebito non è ammesso.')
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

/** Etichetta del tipo; per `T123`/`M123` riporta la categoria. */
export function etichettaTipo(t: string): string {
  if (!tipoAddebitoValido(t)) throw new Error('Il tipo di addebito non è ammesso.')
  const fissa = ETICHETTE_FISSE[t]
  if (fissa !== undefined) return fissa
  const categoria = t.slice(1)
  return t[0] === 'T'
    ? `Peso netto di tutti i rifiuti di cat. ${categoria} del presente elenco`
    : `Se l'imponibile degli addebiti di tipo V di cat. ${categoria} a prezzo normale è inferiore aggiunge la differenza`
}

export const ETICHETTE_FAMIGLIA: Readonly<Record<FamigliaAddebito, string>> = {
  CER: 'Riga CER',
  VARIABILE: 'Quantità variabile',
  FISSO: 'Importo fisso periodico',
  QUANTITA_MOVIMENTI: 'Quantità dai movimenti',
  CONTEGGIO: 'Conteggio dei movimenti o dei giorni',
  MINIMO: 'Minimo fatturabile',
  ACCONTO: 'Acconto e detrazione',
}

/** Tipi proposti nei menu: `T???` e `M???` stanno per ogni categoria; `CER` non è dell'archivio. */
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

export const ETICHETTE_GENERE_ADDEBITO: Readonly<Record<GenereCodificaAddebito, string>> = {
  GRUPPO: 'Gruppo',
  CATEGORIA: 'Categoria di addebito',
  CATEGORIA_STATISTICA_1: 'Categoria statistica 1',
  CATEGORIA_STATISTICA_2: 'Categoria statistica 2',
  CENTRO_RICAVO: 'Centro di ricavo',
}

/** Concordanza per "Nuovo/Nuova" e articolo, come `CONCORDANZA_GENERE` della 4.1. */
export const CONCORDANZA_GENERE_ADDEBITO: Readonly<
  Record<GenereCodificaAddebito, { nuovo: string; articolo: string }>
> = {
  GRUPPO: { nuovo: 'Nuovo', articolo: 'il' },
  CATEGORIA: { nuovo: 'Nuova', articolo: 'la' },
  CATEGORIA_STATISTICA_1: { nuovo: 'Nuova', articolo: 'la' },
  CATEGORIA_STATISTICA_2: { nuovo: 'Nuova', articolo: 'la' },
  CENTRO_RICAVO: { nuovo: 'Nuovo', articolo: 'il' },
}

export const OPZIONI_GENERE_ADDEBITO = (
  Object.keys(ETICHETTE_GENERE_ADDEBITO) as GenereCodificaAddebito[]
).map(value => ({ value, label: ETICHETTE_GENERE_ADDEBITO[value] }))

/** Nature dell'operazione ammesse nella fattura elettronica (aliquota zero). */
export const ETICHETTE_NATURA_IVA: Readonly<Record<string, string>> = {
  N1: 'Escluse ex art. 15',
  'N2.1': 'Non soggette ad IVA ai sensi degli artt. da 7 a 7-septies',
  'N2.2': 'Non soggette - altri casi',
  'N3.1': 'Non imponibili - esportazioni',
  'N3.2': 'Non imponibili - cessioni intracomunitarie',
  'N3.3': 'Non imponibili - cessioni verso San Marino',
  'N3.4': "Non imponibili - operazioni assimilate alle cessioni all'esportazione",
  'N3.5': "Non imponibili - a seguito di dichiarazioni d'intento",
  'N3.6': 'Non imponibili - altre operazioni che non concorrono alla formazione del plafond',
  N4: 'Esenti',
  N5: 'Regime del margine / IVA non esposta in fattura',
  'N6.1': 'Inversione contabile - cessione di rottami e altri materiali di recupero',
  'N6.2': 'Inversione contabile - cessione di oro e argento puro',
  'N6.3': 'Inversione contabile - subappalto nel settore edile',
  'N6.4': 'Inversione contabile - cessione di fabbricati',
  'N6.5': 'Inversione contabile - cessione di telefoni cellulari',
  'N6.6': 'Inversione contabile - cessione di prodotti elettronici',
  'N6.7': 'Inversione contabile - prestazioni comparto edile e settori connessi',
  'N6.8': 'Inversione contabile - operazioni del settore energetico',
  'N6.9': 'Inversione contabile - altri casi',
  N7: 'IVA assolta in altro stato UE',
}

export const NATURE_IVA: readonly string[] = Object.keys(ETICHETTE_NATURA_IVA)

export const OPZIONI_NATURA_IVA = NATURE_IVA.map(value => ({
  value,
  label: `${value} - ${ETICHETTE_NATURA_IVA[value]}`,
}))

export const ETICHETTE_TIPO_PROVVIGIONE: Readonly<Record<TipoProvvigione, string>> = {
  SCONTATO: 'Sul prezzo scontato',
  LORDO: 'Sul prezzo lordo',
}

export const OPZIONI_TIPO_PROVVIGIONE = (
  Object.keys(ETICHETTE_TIPO_PROVVIGIONE) as TipoProvvigione[]
).map(value => ({ value, label: ETICHETTE_TIPO_PROVVIGIONE[value] }))

export const ETICHETTE_TIPO_VARIAZIONE: Readonly<Record<TipoVariazione, string>> = {
  AUMENTO_PERCENTUALE: 'Aumento in percentuale',
  AUMENTO_IMPORTO: 'Aumento di un importo',
  DIMINUZIONE_PERCENTUALE: 'Diminuzione in percentuale',
  DIMINUZIONE_IMPORTO: 'Diminuzione di un importo',
  SOSTITUZIONE_IVA: 'Sostituzione del codice IVA',
}
