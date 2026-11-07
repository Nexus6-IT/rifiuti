/** Impostazione «fatturazione da» dell'azienda (data AAAA-MM-GG; vuota = fatturazione spenta). */
export interface ImpostazioneFatturazione {
  fatturazioneDa: string | null
  versione: number
  modificatoIl: string | null
  /** Interruttore delle definitive (4.4c, decisione 13): condivide la `versione` con la data. */
  definitiveAttive?: boolean
}

export interface DatiImpostazioneFatturazione {
  fatturazioneDa: string | null
  versione: number
  /** Numero di movimenti toccati già visto e accettato dall'utente. */
  confermaMovimenti?: number
}

// ---------------------------------------------------------------------------------------------
// Legame movimento <-> listino (fase 4.3, spec §4.4, §4.5, §8.1).
// Numeri sempre come stringhe col punto, importi compresi.
// ---------------------------------------------------------------------------------------------

export const STATI_LEGAME = [
  'DA_COLLEGARE',
  'PROPOSTO',
  'CONFERMATO',
  'ESCLUSO',
  'ANNULLATO',
  'FATTURATO',
  'IMPORTATO_FATTURATO',
] as const
export type StatoLegame = (typeof STATI_LEGAME)[number]

/** Stati virtuali della lista «Da collegare» (spec §7.3): non esistono nel database. */
export const STATI_VIRTUALI = ['MANCANTE', 'DA_RIALLINEARE'] as const
export type StatoVirtuale = (typeof STATI_VIRTUALI)[number]
export type StatoLista = StatoLegame | StatoVirtuale

export const MOTIVI_LEGAME = [
  'SENZA_CLIENTE',
  'SENZA_CONTRATTO',
  'SEDE_SENZA_CONTRATTO',
  'CONTRATTO_AMBIGUO',
  'CONTRATTO_NON_ATTIVO',
  'SENZA_ELENCO',
  'ELENCO_SCADUTO',
  'SENZA_RIGA_CER',
  'RIGA_AMBIGUA',
  'SENZA_PREZZO',
  'SENZA_QUANTITA',
] as const
export type MotivoLegame = (typeof MOTIVI_LEGAME)[number]

export const AVVISI_LEGAME = [
  'CLIENTE_NON_DA_FIR',
  'QUANTITA_MANUALE_NON_DERIVATA',
  'CAMBIO_CER_DA_CONFERMARE',
  'PREZZO_MANUALE',
  'CONTRATTO_ALTRA_SEDE',
] as const
export type AvvisoLegame = (typeof AVVISI_LEGAME)[number]

export type FonteCliente = 'FIR' | 'UTENTE'
export type OrigineRiga = 'PRINCIPALE' | 'PROPOSTA' | 'MANUALE'
export type OrigineQuantita = 'DA_MOVIMENTO' | 'MANUALE'

/** Riferimento a un'entità scelta dal legame (cliente, contratto, elenco) con l'etichetta da mostrare. */
export interface VoceScelta {
  id: string
  etichetta: string
}

export interface RigaLegame {
  /** Id della riga del legame (assente nella proposta, non ancora salvata). */
  id?: string
  rigaAddebitoId: string
  ordine: number
  origine: OrigineRiga
  tipo: string
  descrizione: string | null
  tipoQuantita: string | null
  unitaMisura: string
  quantita: string | null
  quantitaOrigine: OrigineQuantita | null
  prezzoSpeciale: boolean
  prezzo: string | null
  sconto: string | null
  prezzoManuale: boolean
  aliquotaIva: string | null
  naturaIva: string | null
  congelataIl: string | null
  /** Importo calcolato dal server con `importoRiga`; mai ricalcolato qui. Null se non calcolabile. */
  importo: string | null
}

/** Alternative per i menu di scelta (spec §8.1: la proposta restituisce anche i candidati). */
export interface CandidatiLegame {
  contratti: VoceScelta[]
  elenchi: VoceScelta[]
  righe: (VoceScelta & { origine: OrigineRiga })[]
}

export interface PropostaLegame {
  /** Falso se la causale non è fatturabile: il blocco «Fatturazione» si nasconde. */
  fatturabile: boolean
  /** Falso se il movimento è prima di «fatturazione da» (o la fatturazione è spenta). */
  attiva: boolean
  stato: StatoLegame
  cliente: (VoceScelta & { fonte: FonteCliente }) | null
  /** Perché manca il cliente (es. «cliente disattivato»); accompagna il motivo SENZA_CLIENTE. */
  dettaglioCliente: string | null
  contratto: VoceScelta | null
  elenco: VoceScelta | null
  righe: RigaLegame[]
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  candidati: CandidatiLegame
}

export interface LegameVista {
  id: string
  movimentoOriginaleId: string
  movimentoVigenteId: string
  stato: StatoLegame
  dataMovimento: string
  cliente: (VoceScelta & { fonte: FonteCliente | null }) | null
  dettaglioCliente: string | null
  contratto: VoceScelta | null
  elenco: VoceScelta | null
  righe: RigaLegame[]
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  motivoEsclusione: string | null
  confermatoIl: string | null
  fatturatoIl: string | null
  riferimentoFattura: string | null
  scostamentoDopoFattura: boolean
  scostamentoIl: string | null
  versione: number
  candidati?: CandidatiLegame
}

export interface RigaLista {
  /** Assente solo per MANCANTE (nessun legame); presente per DA_RIALLINEARE (il legame rimasto indietro). */
  legameId: string | null
  movimentoId: string
  stato: StatoLista
  dataMovimento: string
  cerCode: string
  descrizioneMovimento: string | null
  /** Quantità del movimento (stringa col punto) e unità di misura. */
  quantita: string
  unita: string
  cliente: VoceScelta | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  versione: number | null
  /** Vera se la proposta è completa e si può confermare in massa. */
  confermabile: boolean
  /** Il legame è già fatturato: con DA_RIALLINEARE l'unica azione è registrare lo scostamento. */
  fatturato?: boolean
}

export interface FiltriLista {
  stato?: StatoLista
  /** Più stati insieme: nella query viaggiano separati da virgola. */
  stati?: StatoLista[]
  clienteId?: string
  /** Contratto del legame (UUID); da `?contrattoId=` della pagina «Da collegare». */
  contrattoId?: string
  registroId?: string
  motivo?: MotivoLegame
  dal?: string
  al?: string
  /** Include gli ESCLUSO (per riammetterli). */
  esclusi?: boolean
  pagina?: number
  dimensione?: number
}

export interface ContatoriLegami {
  daCollegare: number
  proposti: number
  mancanti: number
  daRiallineare: number
}

/** `GET /legami-movimento/contatori/per-contratto`: stessi stati della lista, raggruppati. */
export interface ContatoriPerContratto {
  perContratto: { contrattoId: string; daCollegare: number }[]
  /** Legami con cliente ma senza contratto; vuoto se si filtra per contratti. */
  senzaContratto: { clienteId: string; daCollegare: number }[]
}

/**
 * Dati del movimento non ancora registrato (POST /proposta, sola lettura), con i nomi del registro
 * (Task 22): `causale` è il CODICE della causale, `type` è obbligatorio (senza, la proposta è
 * sempre non fatturabile), `quantity` è una stringa col punto.
 */
export interface DatiProposta {
  causale: string
  causaleAziendaId?: string | null
  type: 'CARICO' | 'SCARICO'
  cerCode: string
  /** AAAA-MM-GG. */
  movementDate: string
  unit: string
  /** Stringa col punto, al massimo 3 decimali. */
  quantity: string
  firId?: string | null
  /** Solo controllo di coerenza con il FIR. */
  producerSedeId?: string | null
  scelte?: {
    clienteId?: string
    contrattoId?: string
    elencoId?: string
    /** Selezione completa delle righe (principale e proposte). */
    righe?: { rigaAddebitoId: string }[]
  }
}

/** Modifica di una riga: quantità > 0 (max 3 decimali), prezzo >= 0 (max 6), sconto formula o null. */
export interface ModificaRigaLegame {
  rigaAddebitoId: string
  /** `null` = torna alla quantità del movimento. */
  quantita?: string | null
  prezzo?: string
  sconto?: string | null
  /** Toglie la riga dal legame. */
  rimuovi?: boolean
}

export interface ModificheLegame {
  clienteId?: string
  contrattoId?: string
  elencoId?: string
  righe?: ModificaRigaLegame[]
}

export interface CorpoModificaLegame extends ModificheLegame {
  versione: number
}

export interface CorpoConferma {
  versione: number
  modifiche?: ModificheLegame
}

export interface CorpoEscludi {
  versione: number
  motivo: string
}

/**
 * Blocco «Fatturazione» della risposta di rettifica/annullo (Task 21): come quello della
 * registrazione, con l'esito in più `DA_RIALLINEARE` (il legame esiste ma è rimasto indietro
 * rispetto al movimento: compare in «Da collegare»). Assente se non c'era nulla da collegare.
 * `avvisi` (stringhe di EsitoCorrezioneMovimento) contiene i testi per l'utente.
 */
export interface FatturazioneCorrezione {
  esito: 'COLLEGATO' | 'NON_RIUSCITO' | 'DA_RIALLINEARE'
  legameId: string | null
  stato: StatoLegame | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
}

/**
 * Blocco «Fatturazione» della risposta di registrazione (Task 20): assente se la causale non è
 * fatturabile, la fatturazione è spenta o non ancora attiva, o se è un retry (`giaRegistrato`).
 * I testi per l'utente stanno in `avvisi` del movimento (HTTP 201, mai un errore).
 */
export interface FatturazioneRegistrazione {
  esito: 'COLLEGATO' | 'NON_RIUSCITO'
  legameId: string | null
  stato: StatoLegame | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
}

/** Riga del blocco `legame` di registrazione/rettifica: la selezione completa più i ritocchi. */
export interface RigaLegameRegistrazione {
  rigaAddebitoId: string
  quantita?: string | null
  prezzo?: string
  sconto?: string | null
}

/** Blocco `legame` facoltativo del corpo della registrazione e della rettifica (spec §7.1). */
export interface DatiLegameRegistrazione {
  azione: 'CONFERMA' | 'PROPOSTA'
  clienteId?: string
  contrattoId?: string
  elencoId?: string
  /**
   * SELEZIONE COMPLETA delle righe da tenere (anche quelle non ritoccate: quelle omesse spariscono)
   * più il ritocco dei valori. `rimuovi` non esiste: in registrazione darebbe 400.
   */
  righe?: RigaLegameRegistrazione[]
}

export interface CorpoAzioneMassa {
  azione: 'CONFERMA' | 'ESCLUDI'
  /** Legami già esistenti (con la versione vista). Può essere vuoto se c'è `movimentoIds`. */
  elementi: { legameId: string; versione: number }[]
  /**
   * Movimenti MANCANTI (nessun legame) da lavorare in un solo passo: per ciascuno il backend genera
   * la proposta e poi la conferma o la esclude. Totale con `elementi`: da 1 a 500.
   */
  movimentoIds?: string[]
  /** Obbligatorio con ESCLUDI. */
  motivo?: string
}

export interface EsitoAzioneMassa {
  riusciti: number
  /**
   * `legameId` è null quando il fallimento è avvenuto prima che il legame esistesse (movimento
   * MANCANTE senza proposta). `movimentoId` c'è per gli elementi indicati con `movimentoIds`.
   */
  falliti: { legameId: string | null; movimentoId?: string; codice: string; messaggio: string }[]
}

export interface PerimetroAggiornamento {
  contrattoId?: string
  elencoId?: string
  dal?: string
  al?: string
}

export interface CorpoAggiornaPrezzi {
  perimetro: PerimetroAggiornamento
  /** Assente = anteprima; presente = applica (409 ANTEPRIMA_SUPERATA se i dati sono cambiati). */
  firma?: string
}

export interface DifferenzaAggiornamento {
  legameId: string
  movimentoId: string
  prezzoPrima: string | null
  prezzoDopo: string | null
  scontoPrima: string | null
  scontoDopo: string | null
  /** `progressivo/anno` del movimento nel registro. */
  numeroMovimento: string
  /** `AAAA-MM-GG`. */
  dataMovimento: string
  /** Descrizione della voce di listino (o `CER xx xx xx` / il tipo). */
  voce: string
  /** Ragione sociale del cliente del legame (vuota se non c'e'). */
  cliente: string
}

export type MotivoSaltoAggiornamento =
  | 'FATTURATO'
  | 'IMPORTATO_FATTURATO'
  | 'ESCLUSO'
  | 'ANNULLATO'
  | 'PREZZO_SPECIALE'
  | 'PREZZO_MANUALE'

export interface AnteprimaAggiornamento {
  firma: string
  cambiano: number
  /** Legami non fatturati già allineati al listino (il backend lo manda sempre). */
  invariati: number
  differenze: DifferenzaAggiornamento[]
  saltati: { motivo: MotivoSaltoAggiornamento; numero: number }[]
  /** Legami che dopo l'aggiornamento tornano «Da collegare» (il backend lo manda sempre). */
  daCollegare: number
  /** Righe con prezzo manuale: «escluse, prezzo modificato a mano» (decisione 16). */
  righeEscluseManuali: number
}

export interface EsitoAggiornamento {
  aggiornati: number
  saltati: number
  /** Legami passati a «Da collegare» (il backend lo manda sempre). */
  daCollegare: number
}
