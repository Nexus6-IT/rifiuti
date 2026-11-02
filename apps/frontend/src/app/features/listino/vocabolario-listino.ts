// Vocabolario del listino (4.2a Task 12, 4.2b Task 26). Il dominio (`apps/backend/src/domain/
// listino/{tipi-addebito,codice-iva}.ts`) è la fonte di verità per le forme dei tipi e le regole;
// le etichette (famiglie, nature IVA, tipi di quantità, "applica a", tipi di calcolo, periodi)
// sono scritte qui perché il dominio non le ha. Dal Task 26 ci sono anche la tabella campo x
// famiglia (D9, R16, R48) e le liste per i menu: il backend resta l'arbitro delle regole.
import {
  ApplicaPrezzoSpeciale,
  GenereCodificaAddebito,
  PeriodoScadenze,
  TipoCalcoloScaglione,
  TipoProvvigione,
  TipoQuantita,
  TipoVariazione,
} from './listino.model'

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
  'N6.2':
    'Inversione contabile - cessione di oro e argento ai sensi della legge 7/2000 nonché di oreficeria usata ad OPO',
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

// --- Riga di addebito (4.2b, Task 26) ----------------------------------------------------------

/** Chiavi dei campi di una riga, nell'ordine di D9 (Task 17 del backend, `CampoRiga`). */
export type CampoRiga =
  | 'tipo'
  | 'cerCode'
  | 'addebitoId'
  | 'riferimento'
  | 'descrizione'
  | 'tipoQuantita'
  | 'quantitaFissa'
  | 'unitaMisura'
  | 'prezzo'
  | 'prezzoSpeciale'
  | 'sconto'
  | 'codiceIvaId'
  | 'provvigione'
  | 'tipoProvvigione'
  | 'tipologiaRifiuto'
  | 'statoFisico'
  | 'operazione'
  | 'categoriaId'
  | 'centroRicavoId'
  | 'applicaA'
  | 'condizione'
  | 'condizioniRiferite'
  | 'minimoFatturabile'
  | 'minimoPerCategoria'
  | 'riferimentoGiorno'
  | 'riferimentoMese'
  | 'periodoScadenze'
  | 'periodoExtraDal'
  | 'periodoExtraAl'
  | 'stimaAnnuaKg'
  | 'cerProposta'
  | 'addebitiProposti'
  | 'appunti'
  | 'notaUsoInterno'
  | 'scaglioni'
  | 'scadenze'

// Copia di `CAMPI_PER_FAMIGLIA` del Task 17 (`domain/listino/riga-addebito.ts`, D9): non si importa
// fra app, quindi va tenuta allineata a mano (la spec ha la tabella attesa famiglia per famiglia).
const COMUNI: readonly CampoRiga[] = [
  'tipo',
  'riferimento',
  'descrizione',
  'unitaMisura',
  'prezzo',
  'codiceIvaId',
  'provvigione',
  'tipoProvvigione',
  'categoriaId',
  'centroRicavoId',
  'appunti',
  'notaUsoInterno',
]
const PREZZO_SPECIALE: readonly CampoRiga[] = [
  'prezzoSpeciale',
  'applicaA',
  'condizioniRiferite',
  'scaglioni',
  'riferimentoGiorno',
  'riferimentoMese',
]
const MINIMO: readonly CampoRiga[] = ['minimoFatturabile', 'minimoPerCategoria']

/**
 * Campi che valgono per ogni famiglia (D9). Lo sconto manca nei minimi e negli acconti; la
 * provvigione si limita ai soli `$D`/`$R` nella validazione del backend (la famiglia `ACCONTO`
 * comprende anche `$A`). Serve ad abilitare i campi del form: il backend resta l'arbitro (R36).
 */
export const CAMPI_PER_FAMIGLIA: Readonly<Record<FamigliaAddebito, readonly CampoRiga[]>> = {
  CER: [
    ...COMUNI,
    'cerCode',
    'sconto',
    'tipoQuantita',
    'tipologiaRifiuto',
    'statoFisico',
    'operazione',
    'addebitiProposti',
    'stimaAnnuaKg',
    'condizione',
    ...PREZZO_SPECIALE,
    ...MINIMO,
  ],
  VARIABILE: [
    ...COMUNI,
    'addebitoId',
    'sconto',
    'tipoQuantita',
    'cerProposta',
    'stimaAnnuaKg',
    'condizione',
    ...PREZZO_SPECIALE,
    ...MINIMO,
  ],
  FISSO: [
    ...COMUNI,
    'addebitoId',
    'sconto',
    'quantitaFissa',
    'condizione',
    'periodoScadenze',
    'periodoExtraDal',
    'periodoExtraAl',
    'scadenze',
  ],
  QUANTITA_MOVIMENTI: [...COMUNI, 'addebitoId', 'sconto', 'condizione', ...PREZZO_SPECIALE],
  CONTEGGIO: [...COMUNI, 'addebitoId', 'sconto', 'condizione', ...PREZZO_SPECIALE],
  MINIMO: [...COMUNI, 'addebitoId'],
  ACCONTO: [...COMUNI, 'addebitoId'],
}

export function campoAbilitato(famiglia: FamigliaAddebito, campo: CampoRiga): boolean {
  return CAMPI_PER_FAMIGLIA[famiglia].includes(campo)
}

/** E15: tipo di quantità delle righe `CER` e `V`. */
export const ETICHETTE_TIPO_QUANTITA: Readonly<Record<TipoQuantita, string>> = {
  PESO_NETTO: 'Peso netto',
  PESO_LORDO: 'Peso lordo',
  VOLUME: 'Volume',
  UNO: 'Sempre 1',
  ALTRO: 'Altro (si indica nel documento)',
}

export const OPZIONI_TIPO_QUANTITA = (Object.keys(ETICHETTE_TIPO_QUANTITA) as TipoQuantita[]).map(
  value => ({ value, label: ETICHETTE_TIPO_QUANTITA[value] })
)

/** E13: a cosa si applica il prezzo speciale. */
export const ETICHETTE_APPLICA_A: Readonly<Record<ApplicaPrezzoSpeciale, string>> = {
  DOCUMENTO: 'A ogni singolo documento',
  PERIODO: 'Al totale del periodo di fatturazione',
  PROGRESSIVO_DA_DATA: 'Al totale progressivo dalla data indicata',
  CONGUAGLIO_365: '365 giorni prima della data di conguaglio',
  GIORNO: 'Al totale di ogni singolo giorno movimentato',
}

export const OPZIONI_APPLICA_A = (Object.keys(ETICHETTE_APPLICA_A) as ApplicaPrezzoSpeciale[]).map(
  value => ({ value, label: ETICHETTE_APPLICA_A[value] })
)

/**
 * Tipi di calcolo delle fasce. `E` e `H` fatturano tutta la quantità al prezzo dell'ultima fascia,
 * come `D`, e non lasciano le righe delle fasce precedenti (R29, R50): nessuna quantità si
 * fattura due volte. Le descrizioni complete con i casi arrivano con il Task 28.
 */
export const ETICHETTE_TIPO_CALCOLO: Readonly<Record<TipoCalcoloScaglione, string>> = {
  A: 'A - quantità di ogni fascia al prezzo della fascia, in progressione',
  B: 'B - importo fisso della fascia più alta raggiunta',
  C: 'C - importo fisso di ogni fascia raggiunta',
  D: 'D - tutta la quantità al prezzo della fascia raggiunta',
  E: "E - tutta la quantità al prezzo dell'ultima fascia (come D)",
  X: 'X - come A, con condizione',
  Y: 'Y - come B, con condizione',
  Z: 'Z - come C, con condizione',
  W: 'W - come D, con condizione',
  H: 'H - come E, con condizione',
}

export const OPZIONI_TIPO_CALCOLO = (
  Object.keys(ETICHETTE_TIPO_CALCOLO) as TipoCalcoloScaglione[]
).map(value => ({ value, label: ETICHETTE_TIPO_CALCOLO[value] }))

/** Periodo cui si riferisce ogni scadenza di un addebito fisso (D14); `X…` e `YC` sono extra. */
export const ETICHETTE_PERIODO_SCADENZE: Readonly<Record<PeriodoScadenze, string>> = {
  MP: '1 mese posticipato',
  BA: '2 mesi anticipato',
  BP: '2 mesi posticipato',
  TA: '3 mesi anticipato',
  TP: '3 mesi posticipato',
  QA: '4 mesi anticipato',
  QP: '4 mesi posticipato',
  SA: '6 mesi anticipato',
  SP: '6 mesi posticipato',
  AA: '12 mesi anticipato',
  AP: '12 mesi posticipato',
  DA: '24 mesi anticipato',
  DP: '24 mesi posticipato',
  XA: 'Scadenza extra aggiuntiva',
  XD: 'Scadenza extra, detrazione',
  YC: 'Scadenza extra, nota di credito',
}

export const OPZIONI_PERIODO_SCADENZE = (
  Object.keys(ETICHETTE_PERIODO_SCADENZE) as PeriodoScadenze[]
).map(value => ({
  value,
  label: `${value} - ${ETICHETTE_PERIODO_SCADENZE[value]}`,
}))

/** Periodi extra: richiedono il periodo "dal ... al ..." scritto a parte. */
export const PERIODI_EXTRA: readonly PeriodoScadenze[] = ['XA', 'XD', 'YC']
