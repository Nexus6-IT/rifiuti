import {
  CodiceRinnovo,
  EsigibilitaIva,
  GenereCodifica,
  ModalitaPagamento,
  StatoContrattoCliente,
  TipoSpesa,
  UnitaValidita,
} from './clienti.model'

export const ETICHETTE_MODALITA: Readonly<Record<ModalitaPagamento, string>> = {
  MP01: 'Contanti',
  MP02: 'Assegno',
  MP05: 'Bonifico',
  MP08: 'Carta di pagamento',
  MP12: 'RiBa',
  MP19: 'SEPA Direct Debit',
  MP23: 'PagoPA',
}

export const ETICHETTE_TIPO_SPESA: Readonly<Record<TipoSpesa, string>> = {
  INCASSO: 'Spese di incasso',
  BOLLO: 'Bollo',
}

export const ETICHETTE_GENERE: Readonly<Record<GenereCodifica, string>> = {
  CATEGORIA: 'Categoria',
  TIPO: 'Tipo di contratto',
  MOTIVO_ANNULLO: 'Motivo di annullo',
}

function opzioni<K extends string>(etichette: Readonly<Record<K, string>>) {
  return (Object.keys(etichette) as K[]).map(value => ({ value, label: etichette[value] }))
}

export const OPZIONI_MODALITA = opzioni(ETICHETTE_MODALITA)
export const OPZIONI_TIPO_SPESA = opzioni(ETICHETTE_TIPO_SPESA)
/** Concordanza di articolo e aggettivo per genere (la categoria è femminile). */
export const CONCORDANZA_GENERE: Readonly<
  Record<GenereCodifica, { nuovo: string; articolo: string }>
> = {
  CATEGORIA: { nuovo: 'Nuova', articolo: 'la' },
  TIPO: { nuovo: 'Nuovo', articolo: 'il' },
  MOTIVO_ANNULLO: { nuovo: 'Nuovo', articolo: 'il' },
}

export const OPZIONI_GENERE = opzioni(ETICHETTE_GENERE)

export const ETICHETTE_ESIGIBILITA: Readonly<Record<EsigibilitaIva, string>> = {
  IMMEDIATA: 'Immediata',
  DIFFERITA: 'Differita',
  SCISSIONE: 'Split payment',
}

export const OPZIONI_ESIGIBILITA = opzioni(ETICHETTE_ESIGIBILITA)

/** Stati del contratto cliente (D8). */
export const ETICHETTE_STATO_CONTRATTO: Readonly<Record<StatoContrattoCliente, string>> = {
  BOZZA: 'Bozza',
  ATTIVO: 'Attivo',
  SOSPESO: 'Sospeso',
  SOSPESO_MOVIMENTI: 'Sospeso (solo movimenti)',
  ANNULLATO: 'Annullato',
}

export const OPZIONI_STATO_CONTRATTO = opzioni(ETICHETTE_STATO_CONTRATTO)

/** Transizioni ammesse (D8); la vista del contratto porta comunque `transizioni`. */
export const TRANSIZIONI_STATO: Readonly<
  Record<StatoContrattoCliente, readonly StatoContrattoCliente[]>
> = {
  BOZZA: ['ATTIVO'],
  ATTIVO: ['SOSPESO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'],
  SOSPESO: ['ATTIVO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'],
  SOSPESO_MOVIMENTI: ['ATTIVO', 'SOSPESO', 'ANNULLATO'],
  ANNULLATO: [],
}

/** Frequenze predefinite dei periodi di fatturazione (`periodiDaFrequenza` del backend). */
export type FrequenzaPeriodi =
  | 'MENSILE'
  | 'BIMESTRALE'
  | 'TRIMESTRALE'
  | 'QUADRIMESTRALE'
  | 'SEMESTRALE'
  | 'ANNUALE'

export const ETICHETTE_FREQUENZA: Readonly<Record<FrequenzaPeriodi, string>> = {
  MENSILE: 'Mensile',
  BIMESTRALE: 'Bimestrale',
  TRIMESTRALE: 'Trimestrale',
  QUADRIMESTRALE: 'Quadrimestrale',
  SEMESTRALE: 'Semestrale',
  ANNUALE: 'Annuale',
}

export const OPZIONI_FREQUENZA = opzioni(ETICHETTE_FREQUENZA)

export const ETICHETTE_UNITA_VALIDITA: Readonly<Record<UnitaValidita, string>> = {
  A: 'Anni',
  S: 'Semestri',
  M: 'Mesi',
  G: 'Giorni',
}

export const OPZIONI_UNITA_VALIDITA = opzioni(ETICHETTE_UNITA_VALIDITA)

/** Codici di rinnovo ammessi (D27, Q8): solo S e N. */
export const ETICHETTE_CODICE_RINNOVO: Readonly<Record<CodiceRinnovo, string>> = {
  S: 'S - Sì',
  N: 'N - No',
}

export const OPZIONI_CODICE_RINNOVO = opzioni(ETICHETTE_CODICE_RINNOVO)
