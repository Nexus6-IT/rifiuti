// Tipi del Bilancio: la sintesi annuale per il titolare dell'azienda.

export type BloccoBilancio =
  | 'PRODOTTO'
  | 'DESTINAZIONE'
  | 'PRINCIPALI'
  | 'PERICOLOSI'
  | 'MUD'
  | 'MESI'
  | 'SEGNALI'
  | 'GIACENZA'

export type CodiceLacuna =
  | 'NESSUN_MOVIMENTO'
  | 'UNITA_NON_CONVERTITE'
  | 'STIMA_PESO_SPECIFICO'
  | 'ESCLUSI_COME_NEL_MUD'
  | 'CONFRONTO_PARZIALE'
  | 'OPERAZIONE_DA_VERIFICARE'
  | 'PRELIMINARI_NON_COERENTI'
  | 'MESI_SENZA_MOVIMENTI'
  | 'SEGNALE_NON_DISPONIBILE'

export interface LacunaBilancio {
  blocco: BloccoBilancio
  codice: CodiceLacuna
  testo: string
}

export interface PeriodoBilancio {
  anno: number
  /** 'AAAA-MM-GG', sempre il 1° gennaio. */
  dal: string
  /** 'AAAA-MM-GG': oggi (anno in corso) o 31 dicembre. */
  al: string
  annoInCorso: boolean
  /** Stesso giorno e mese di `al` nell'anno prima (29/02 -> 28/02). */
  alAnnoPrecedente: string
  /** 1..12: mese di `al`. */
  mesiDelPeriodo: number
}

export type StatoMudBilancio =
  | 'DRAFT'
  | 'REVIEWING'
  | 'SUBMITTED'
  | 'ARCHIVED'
  | 'NON_INIZIATO'
  | 'NON_DOVUTO'

export interface RigaStatoMud {
  /** null finché il MUD non è per sede (F2-8). */
  sede: string | null
  annoDati: number
  stato: StatoMudBilancio
  /** 'AAAA-MM-GG'. */
  scadenza: string
  fonteScadenza: 'TRACCIATO' | 'ORDINARIA'
  scaduta: boolean
}

export interface ConteggiSegnali {
  ritardiRegistro: number | null
  firSenzaRiscontro: number | null
  avvisiDeposito: number | null
}

export interface BilancioAzienda {
  periodo: PeriodoBilancio
  /** ISO 8601. */
  generatoIl: string
  fonti: Record<BloccoBilancio, string>
  prodotto: {
    kg: number
    confronto: {
      annoPrecedente: number
      kgCorrente: number
      kgPrecedente: number
      variazione: number | null
    }
  }
  destinazione: {
    recuperoKg: number
    smaltimentoKg: number
    diCuiR13Kg: number
    diCuiD15Kg: number
    daVerificareKg: number
    movimentiDaVerificare: number
  }
  principali: Array<{ cerCode: string; descrizione: string | null; kg: number }>
  pericolosi: { kg: number; quota: number | null }
  mud: { righe: RigaStatoMud[] }
  mesi: { conMovimenti: number[]; delPeriodo: number }
  segnali: ConteggiSegnali
  giacenzaFinePeriodoKg: number
  lacune: LacunaBilancio[]
}
