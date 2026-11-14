/**
 * Dati di un record del file COBAT (`Movcob.txt`, struct `cob` di WinWaste), uno per movimento.
 * Tutto e' gia' risolto dal preparatore: il serializzatore non legge il database e non decide
 * nulla. Date `AAAA-MM-GG`; `codreg` e' la lettera di WinWaste (`regioni-istat.ts`).
 */

/** Blocco «sede legale» (p, t, s): descr, regione, via, CAP, ISTAT, localita, recapiti, CF, civico, legale rappresentante. */
export interface BloccoSedeLegaleCobat {
  descrizione: string
  codreg: string
  via: string
  cap: string
  /** ISTAT del comune, 6 cifre. */
  codcom: string
  localita: string
  telefono: string
  fax: string
  codiceFiscale: string
  civico: string
  /** Cognome e nome del legale rappresentante (vuoti se non noti). */
  legaleRappresentanteCognome: string
  legaleRappresentanteNome: string
  /** `S` se il soggetto e' un comune, altrimenti `N`. */
  comune: 'S' | 'N'
  partitaIva: string
}

/** Blocco «unita' locale» (x, y). */
export interface BloccoUnitaLocaleCobat {
  codreg: string
  via: string
  cap: string
  codcom: string
  localita: string
  telefono: string
  fax: string
  /** Codice attivita' (ATECO, 6 cifre). */
  codiceAttivita: string
  civico: string
}

/** Blocco intermediario (c). */
export interface BloccoIntermediarioCobat {
  descrizione: string
  codreg: string
  via: string
  cap: string
  codcom: string
  localita: string
  telefono: string
  fax: string
  codiceFiscale: string
  civico: string
  partitaIva: string
}

export interface RecordCobat {
  /** Movimento di origine (per i messaggi di errore); non finisce nel file. */
  riferimento: string
  dataRegistrazione: string
  /** 6 cifre. */
  progressivo: string
  codazi: string
  /** 1-7; `null` = non determinato (bloccante). */
  tipoMovimento: number | null
  targa: string
  rimorchio: string
  /** Numero del FIR (20). */
  bolla: string
  /** Vuota se il movimento non ha FIR. */
  dataFormulario: string
  /** 1-5; `null` = spazio (avviso non bloccante). */
  causa: number | null
  autista: string
  dataConferimento: string
  cer: string
  /** PGF/tipologia `A..E`, o vuota. */
  pgf: string
  quam3: number
  quaton: number
  produttore: { sedeLegale: BloccoSedeLegaleCobat; unitaLocale: BloccoUnitaLocaleCobat } | null
  trasportatore: { sedeLegale: BloccoSedeLegaleCobat } | null
  smaltitore: { sedeLegale: BloccoSedeLegaleCobat; unitaLocale: BloccoUnitaLocaleCobat } | null
  intermediario: BloccoIntermediarioCobat | null
  campagnaCodice: string
  campagnaDescrizione: string
}

export interface DatiFileCobat {
  record: RecordCobat[]
}
