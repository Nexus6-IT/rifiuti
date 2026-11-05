// Modelli delle impostazioni di fatturazione della 4.4a: dati del cedente e numerazione.
// `CedenteVista` e `NumerazioneVista` sono copiati alla lettera dai Task 7 e 8 del piano (il
// backend si scrive in parallelo); il Task 13 confronta le chiavi con le risposte reali.
// Numeri e importi sempre come stringhe col punto.

export interface CedenteVista {
  regimeFiscale: string | null
  reaUfficio: string | null
  capitaleSociale: string | null
  socioUnico: 'SU' | 'SM' | null
  statoLiquidazione: 'LN' | 'LS'
  registroIvaPredefinitoId: string | null
  idTrasmittenteCodice: string | null
  versione: number
  daTenant: {
    ragioneSociale: string
    partitaIva: string | null
    codiceFiscale: string | null
    indirizzo: string | null
    cap: string | null
    comune: string | null
    provincia: string | null
    numeroRea: string | null
  }
  completo: boolean
  mancanti: string[]
}

/** Corpo del `PUT /cedente-fatturazione` (Task 7). */
export interface DatiCedente {
  regimeFiscale: string
  reaUfficio?: string | null
  capitaleSociale?: string | null
  socioUnico?: 'SU' | 'SM' | null
  statoLiquidazione: 'LN' | 'LS'
  registroIvaPredefinitoId?: string | null
  idTrasmittenteCodice?: string | null
  versione: number
}

export interface NumerazioneVista {
  registroIvaId: string
  codiceRegistro: string
  anno: number
  ultimoNumero: number
  ultimaData: string | null
  numeroPartenza: number
  dataPartenza: string | null
  partenzaModificabile: boolean
  versione: number
}

/** Corpo del `PUT /numerazioni-fattura/:registroIvaId/:anno` (Task 8). */
export interface DatiPartenza {
  numeroPartenza: number
  dataPartenza: string | null
  versione: number
}

/** Codice 409 del `PUT` della partenza quando esiste già un DEFINITIVO o un ANNULLATO (Task 8). */
export const PARTENZA_NON_MODIFICABILE = 'PARTENZA_NON_MODIFICABILE'

// Enumerazione RegimeFiscale dell'XSD vigente (Task 1, scansione P8): RF01, RF02, RF04-RF20, senza
// RF03. Il Task 16 del piano prova che coincide con l'XSD.
export const REGIMI_FISCALI: readonly string[] = [
  'RF01',
  'RF02',
  'RF04',
  'RF05',
  'RF06',
  'RF07',
  'RF08',
  'RF09',
  'RF10',
  'RF11',
  'RF12',
  'RF13',
  'RF14',
  'RF15',
  'RF16',
  'RF17',
  'RF18',
  'RF19',
  'RF20',
]

/** Descrizioni brevi dei regimi, per il menu (il codice resta sempre in testa). */
export const DESCRIZIONI_REGIMI: Readonly<Record<string, string>> = {
  RF01: 'Ordinario',
  RF02: 'Contribuenti minimi',
  RF04: 'Agricoltura e attività connesse e pesca',
  RF05: 'Vendita sali e tabacchi',
  RF06: 'Commercio di fiammiferi',
  RF07: 'Editoria',
  RF08: 'Gestione di servizi di telefonia pubblica',
  RF09: 'Rivendita di documenti di trasporto pubblico e di sosta',
  RF10: 'Intrattenimenti, giochi e altre attività',
  RF11: 'Agenzie di viaggi e turismo',
  RF12: 'Agriturismo',
  RF13: 'Vendite a domicilio',
  RF14: 'Rivendita beni usati, oggetti d’arte, d’antiquariato o da collezione',
  RF15: 'Agenzie di vendite all’asta di oggetti d’arte, antiquariato o da collezione',
  RF16: 'IVA per cassa della PA',
  RF17: 'IVA per cassa (art. 32-bis, D.L. 83/2012)',
  RF18: 'Altro',
  RF19: 'Forfettario',
  RF20: 'Regime transfrontaliero di Franchigia IVA (Direttiva UE 2020/285)',
}
