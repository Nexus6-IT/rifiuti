/**
 * Tipi per l'export telematico del MUD (formato sequenziale multirecord
 * Unioncamere/Ecocerved). Vedi docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf.
 */

/** Anagrafica del soggetto dichiarante (azienda / unità locale). */
export interface MudAzienda {
  ragioneSociale: string
  partitaIva: string
  codiceFiscale?: string
  /** Indirizzo sede legale (opzionale per tenant creati via signup self-service). */
  via?: string
  civico?: string
  /** Comune sede legale (opzionale per tenant creati via signup self-service). */
  comune?: string
  /** Provincia (sigla 2 lettere, opzionale per tenant creati via signup self-service). */
  provincia?: string
  /** CAP (5 cifre, opzionale per tenant creati via signup self-service). */
  cap?: string
  pec?: string
  telefono?: string
  /** Codice attività economica ISTAT (ATECO 2007, 6 cifre). */
  atecoCode?: string
  /** Codice ISTAT del comune (6 cifre), risolto dalle tabelle di riferimento. */
  comuneCode?: string
  /** N° iscrizione REA. */
  reaNumber?: string
  /** Totale addetti nell'unità locale. */
  numeroAddetti?: number
  legaleRappresentanteNome?: string
  legaleRappresentanteCognome?: string
}

/**
 * Stato fisico del rifiuto (Scheda RIF). Default: solido non polverulento.
 *
 * Il tracciato 6.04/25 rinomina tre voci — «Solido polverulento» →
 * «In polvere o polverulento», «Solido NON polverulento» → «Solido»,
 * «Fangoso palabile» → «Fangoso» — ma **posizioni e struttura del record non
 * cambiano**: gli identificatori restano quelli storici per non rompere i dati
 * già persistiti.
 */
export type StatoFisico =
  | 'SOLIDO_POLVERULENTO'
  | 'SOLIDO_NON_POLVERULENTO'
  | 'FANGOSO_PALABILE'
  | 'LIQUIDO'
  | 'AERIFORME'
  | 'VISCHIOSO_SCIROPPOSO'
  | 'ALTRO'

/** Ente che ha rilasciato l'autorizzazione (record AU). */
export type MudEnteAutorizzante = 0 | 1 | 2 | 3

/**
 * Tipo di autorizzazione (record AU, «Tabella dei Codici di Procedura»).
 *  0 = ND
 *  1 = Autorizzazione unica nuovi impianti — art. 208 D.Lgs. 152/2006
 *  2 = Impianti mobili — art. 208 c.15
 *  3 = Rifiuti liquidi in impianti acque reflue urbane — artt. 110 e 208
 *  4 = Impianti di ricerca e sperimentazione — art. 211
 *  5 = Autorizzazione Integrata Ambientale — art. 29-ter e 213
 *  6 = Procedura semplificata — artt. 214-216
 * Introdotti dal tracciato **6.04/25** (MUD 2026):
 *  7 = Bonifiche — art. 242 c.7
 *  8 = Autorizzazioni straordinarie — art. 191 (ordinanza contingibile e urgente)
 *  9 = Comunicazione trattamento in impianti acque reflue urbane — art. 110 c.3
 */
export type MudTipoAutorizzazione = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** Classificazione della discarica: 0=ND, 6=pericolosi, 7=non pericolosi, 8=inerti. */
export type MudClassificazioneDiscarica = 0 | 6 | 7 | 8

/** Discarica dichiarata nel record AU (fino a 3 per autorizzazione). */
export interface MudDiscarica {
  classificazione: MudClassificazioneDiscarica
  /** Capacità residua in metri cubi (num 9). */
  capacitaResiduaMc: number
}

/** Scheda SA-AUT (record AU) — autorizzazione o certificazione dell'impianto. */
export interface MudAutorizzazione {
  /** Estremi dell'autorizzazione o dell'iscrizione in procedura semplificata. */
  estremi: string
  dataRilascio?: Date
  dataScadenza?: Date
  enteAutorizzante?: MudEnteAutorizzante
  tipoAutorizzazione?: MudTipoAutorizzazione
  /** Rinnovo mediante autocertificazione. */
  rinnovoAutocertificazione?: boolean
  /** Operazioni di recupero autorizzate, es. `['R3','R4','R13']`. */
  operazioniRecupero?: string[]
  /** Operazioni di smaltimento autorizzate, es. `['D4','D5','D12']`. */
  operazioniSmaltimento?: string[]
  gestisceVFU?: boolean
  gestisceRAEE?: boolean
  /** Autorizzazione EoW (art. 184-ter c.3) — valido solo per tipo 1, 2, 4, 5. */
  autorizzazioneEoW?: boolean
  impiantoIncenerimento?: boolean
  /** Capacità autorizzate in t/a (num 9). Usate anche per la procedura semplificata. */
  capacitaComplessivaTa?: number
  capacitaPericolosiTa?: number
  capacitaNonPericolosiTa?: number
  impiantoCoincenerimento?: boolean
  capacitaCoincComplessivaTa?: number
  capacitaCoincPericolosiTa?: number
  capacitaCoincNonPericolosiTa?: number
  /** Fino a 3 discariche; le posizioni non valorizzate sono azzerate. */
  discariche?: MudDiscarica[]
  emasPrimaRegistrazione?: Date
  emasNumeroRegistrazione?: string
  iso14001Emissione?: Date
}

/** Frazione oggetto della scheda SA-RIC (record AR): 1=Vetro … 11=Oli e grassi minerali. */
export type MudFrazioneRiciclaggio = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11

/** Blocco quantità della scheda SA-RIC (ripetuto per urbani e per imballaggi). */
export interface MudRiciclaggioQuantita {
  /** Quantità totale di rifiuti trattata nell'anno (obbligatoria). */
  trattataKg: number
  /** Scarti generati da trattamenti preliminari all'operazione finale. */
  scartiPreliminariKg?: number
  /** Quantità totale trattata nell'operazione finale di riciclaggio (obbligatoria). */
  finaleRiciclaggioKg: number
  /** Scarti generati dall'operazione finale di riciclaggio. */
  scartiFinaliKg?: number
  /** Quantità totale preparata per il riutilizzo. */
  preparataRiutilizzoKg?: number
}

/** Scheda SA-RIC (record AR) — riciclaggio per frazione. */
export interface MudRiciclaggio {
  frazione: MudFrazioneRiciclaggio
  /** Operazioni di recupero eseguite (flag) fra quelle previste dalla scheda. */
  operazioni?: {
    r3?: boolean
    r4?: boolean
    r5?: boolean
    r9?: boolean
    r12?: boolean
    r13?: boolean
  }
  /** Almeno una fra `urbani` e `imballaggi` deve essere valorizzata. */
  urbani?: MudRiciclaggioQuantita
  imballaggi?: MudRiciclaggioQuantita
}

/** Modulo RT (BB) — rifiuto ricevuto da terzi. */
export interface MudAllegatoRT {
  codiceFiscale: string
  ragioneSociale: string
  istatProvincia?: string
  istatComune?: string
  indirizzo?: string
  civico?: string
  cap?: string
  quantitaKg: number
  /** Rifiuto ricevuto da soggetti privati. */
  ricevutoDaPrivati?: boolean
  /** Origine urbana — ammesso solo per CER 1912xx, 190501, 190503. */
  origineUrbana?: boolean
  /** Pile e accumulatori portatili — solo CER 160601-160605, 200133, 200134. */
  pileAccumulatori?: boolean
}

/**
 * Modulo RE (record BC) — rifiuto prodotto fuori dall'unità locale.
 * `attivitaOrigine`: 0=ND, 2=Manutenzioni, 4=Bonifica amianto,
 * 5=Assistenza sanitaria, 6=Cantieri temporanei e mobili.
 */
export interface MudAllegatoRE {
  istatProvincia?: string
  istatComune?: string
  attivitaOrigine?: 0 | 2 | 4 | 5 | 6
  quantitaKg: number
}

/** Operazioni di smaltimento dichiarabili nel record BD (D1/D5/D12 via discarica). */
export type MudOperazioneSmaltimento =
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D6'
  | 'D7'
  | 'D8'
  | 'D9'
  | 'D10'
  | 'D11'
  | 'D13'
  | 'D14'
  | 'D15'

/** Operazioni di recupero dichiarabili nel record BE. */
export type MudOperazioneRecupero =
  | 'R1'
  | 'R2'
  | 'R3'
  | 'R4'
  | 'R5'
  | 'R6'
  | 'R7'
  | 'R8'
  | 'R9'
  | 'R10'
  | 'R11'
  | 'R12'
  | 'R13'

/**
 * Modulo MG (record BD + BE) — gestione dei rifiuti nell'unità locale.
 *
 * Il modulo completo è composto da due record: `BD` (smaltimento e deposito
 * definitivo) e `BE` (recupero e giacenze al 31/12). Vengono emessi in coppia.
 */
export interface MudModuloGestione {
  /**
   * Tipologia di impianto (num 2): 0=ND, 21=discarica, 22=compostaggio,
   * 23=inceneritore, 24=chimico-fisico/biologico, 25=coincenerimento,
   * 26=digestione anaerobica, 27=recupero di materia, 29=smaltimento,
   * 30=deposito preliminare, 31=messa in riserva, 32=anaerobico/aerobico,
   * 33=trattamento meccanico-biologico urbani, 34=trattamento preliminare.
   */
  tipologiaImpianto?: number
  /** Operazioni di smaltimento su ordinanza sindacale art. 191 D.Lgs. 152/2006. */
  smaltimentoSuOrdinanza?: boolean
  classificazioneDiscarica?: MudClassificazioneDiscarica
  /** Quantità depositata in discarica nell'anno, **in tonnellate** (da tracciato). */
  quantitaDiscaricaTon?: number
  /** Quantità per operazione di smaltimento (kg). */
  smaltimento?: Partial<Record<MudOperazioneSmaltimento, number>>
  /** Quantità per operazione di recupero (kg). */
  recupero?: Partial<Record<MudOperazioneRecupero, number>>
  /** Rifiuto in giacenza al 31/12 da avviare a recupero (kg). */
  giacenzaRecuperoKg?: number
  /** Rifiuto in giacenza al 31/12 da avviare a smaltimento (kg). */
  giacenzaSmaltimentoKg?: number
}

/** Modulo UO/UD (record DB) — unità locale di origine o destinazione del rifiuto. */
export interface MudUnitaOrigineDestinazione {
  codiceFiscale: string
  ragioneSociale: string
  istatProvincia?: string
  istatComune?: string
  indirizzo?: string
  civico?: string
  /** Paese estero, solo se di origine non nazionale. */
  paeseEstero?: string
  /** Quantità acquisita (UO) o ceduta (UD) nell'anno. */
  quantitaKg: number
}

/** Scheda INT (record DA) — rifiuti commercializzati e intermediati senza detenzione. */
export interface MudIntermediazione {
  cerCode: string
  statoFisico?: StatoFisico
  /** Quantità complessivamente intermediata. */
  quantitaIntermediataKg: number
  /** Unità locali di origine del rifiuto (moduli UO). */
  uo?: MudUnitaOrigineDestinazione[]
  /** Unità locali di destinazione del rifiuto (moduli UD). */
  ud?: MudUnitaOrigineDestinazione[]
}

/** Modulo DR (BB) — rifiuto conferito a terzi (destinatario). */
export interface MudAllegatoDR {
  codiceFiscale: string
  ragioneSociale: string
  /** Codice ISTAT provincia (3 cifre) — dalla parte iniziale del codice comune. */
  istatProvincia?: string
  /** Codice ISTAT comune (3 cifre) — dalla parte finale del codice comune. */
  istatComune?: string
  indirizzo?: string
  civico?: string
  cap?: string
  quantitaKg: number
  /** Destinatario estero: nome della nazione, al posto del codice fiscale (A-W-05). */
  nazione?: string
}

/** Modulo TE (BB) — rifiuto trasportato da terzi (trasportatore): solo CF + R.S. */
export interface MudAllegatoTE {
  codiceFiscale: string
  ragioneSociale: string
}

/** Riga rifiuto (Scheda RIF) — quantità per codice CER/EER. */
export interface MudRifiutoLine {
  cerCode: string
  /** Rifiuto prodotto nell'unità locale (kg). */
  prodottoKg: number
  /** Quantità complessiva avviata a recupero (kg). */
  recuperoKg: number
  /** Quantità complessiva avviata a smaltimento (kg). */
  smaltimentoKg: number
  /** Stato fisico; default SOLIDO_NON_POLVERULENTO (tipico dei metalli/solidi). */
  statoFisico?: StatoFisico
  /** Moduli BB DR (conferiti a terzi/destinatari). */
  dr?: MudAllegatoDR[]
  /** Moduli BB TE (trasportatori). */
  te?: MudAllegatoTE[]
  /** Moduli BB RT (ricevuti da terzi) — profilo gestore. */
  rt?: MudAllegatoRT[]
  /** Moduli RE (record BC) — rifiuto prodotto fuori dall'unità locale. */
  re?: MudAllegatoRE[]
  /** Moduli MG (record BD+BE) — gestione svolta nell'unità locale. */
  mg?: MudModuloGestione[]
  /** Rifiuto trasportato dal dichiarante (kg). */
  trasportatoDalDichiaranteKg?: number
  /** Giacenza al 31/12 da avviare a recupero (kg) — Scheda RIF. */
  giacenzaRecuperoKg?: number
  /** Giacenza al 31/12 da avviare a smaltimento (kg) — Scheda RIF. */
  giacenzaSmaltimentoKg?: number
}

/** Anagrafica di un'unità locale (sede) dichiarata in un pacchetto del file. */
export interface MudUnitaLocaleAnagrafica {
  via?: string
  civico?: string
  cap?: string
  comune?: string
  provincia?: string
  /** Codice ISTAT del comune (6 cifre) dell'unità locale. */
  comuneCode?: string
  /** Totale addetti dell'unità locale. */
  numeroAddetti: number
  /** Telefono dell'unità locale: solo se è quello dell'azienda (la sede non ne ha uno proprio). */
  telefono?: string
}

/**
 * Una dichiarazione (un pacchetto AA, AB, AU, BA…) per unità locale: tutte nello stesso file,
 * distinte dal codice dell'unità locale nella chiave di ogni record.
 */
export interface MudDichiarazioneExport {
  /** Codice di identificazione univoca dell'unità locale (1 = azienda / principale). */
  progressivoUnitaLocale: number
  /** Anagrafica della sede; `null` = i dati dell'azienda. */
  unitaLocale: MudUnitaLocaleAnagrafica | null
  rifiuti: MudRifiutoLine[]
  /** Il pacchetto porta le schede AU (autorizzazioni). */
  conAutorizzazioni: boolean
  /** Il pacchetto porta le schede AR (riciclaggio) e INT (intermediazioni). */
  conAllegatiAzienda: boolean
}

/** Dati aggregati per la generazione del file MUD di un anno. */
export interface MudExportData {
  year: number
  azienda: MudAzienda
  rifiuti: MudRifiutoLine[]
  /**
   * Un pacchetto per unità locale, nell'ordine di emissione. Assente = un solo pacchetto con
   * `rifiuti` e le schede dell'azienda. Con `dichiarazioni`, `rifiuti` è la concatenazione e
   * non viene usato.
   */
  dichiarazioni?: MudDichiarazioneExport[]
  /** Schede SA-AUT (record AU) — autorizzazioni dell'impianto. */
  autorizzazioni?: MudAutorizzazione[]
  /** Schede SA-RIC (record AR) — riciclaggio per frazione. */
  riciclaggio?: MudRiciclaggio[]
  /** Schede INT (record DA + DB) — intermediazione senza detenzione. */
  intermediazioni?: MudIntermediazione[]
  /** Istante di creazione del file (testata XX); default: ora corrente. */
  generatedAt?: Date
  /**
   * Dichiarazione sostitutiva (A-W-04): presente se per l'anno risulta già una comunicazione
   * presentata. Il record AA dei pacchetti con un progressivo in `progressivi` (assente = {1})
   * porta allora «annulla e sostituisce» = 1 e la sua data.
   */
  sostituisce?: { dataComunicazione: Date; progressivi?: number[] }
}

/** Risultato dell'export: contenuto del file + metadati. */
export interface MudExportResult {
  filename: string
  content: string
  version: string
  year: number
}

/**
 * Generatore del tracciato MUD per una specifica **versione/anno**.
 * Ogni anno di dichiarazione ha la propria implementazione (versionamento):
 * vedi `MudVersionRegistry`.
 */
export interface MudTracciatoVersion {
  /** Costante release del tracciato (es. "6.04/24"). */
  readonly version: string
  /** Anno di dichiarazione coperto (es. 2024). */
  readonly year: number
  /** Scadenza di presentazione della dichiarazione, 'AAAA-MM-GG' (da DPCM/GU del tracciato). */
  readonly scadenzaPresentazione: string
  /** Produce il contenuto del file telematico dai dati aggregati. */
  generate(data: MudExportData): string
}
