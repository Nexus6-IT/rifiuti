import { GenereCodifica, ModalitaPagamento, TipoSpesa } from './clienti.model'

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
export const OPZIONI_GENERE = opzioni(ETICHETTE_GENERE)
