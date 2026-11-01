// Modelli del listino (4.2a, Task 12): copiano le `…Vista` dei Task 8-9 e 10 del piano. Prezzi,
// sconti, provvigioni e aliquote viaggiano come stringhe decimali, mai `number` (R12). I modelli
// delle righe e degli elenchi (4.2b) arrivano con il Task 26 (R16).

interface Versionata {
  id: string
  versione: number
  /** Nessun addebito la cita: si può cancellare invece di disattivare. */
  eliminabile: boolean
}

// --- Codici IVA -------------------------------------------------------------------------------

export interface DatiCodiceIva {
  /** Da 1 a 3 lettere o cifre, maiuscole. */
  codice: string
  descrizione: string
  /** Decimale a due cifre, es. "22.00". */
  aliquota: string
  /** Obbligatoria con aliquota zero, vietata altrimenti. */
  natura: string | null
  attivo: boolean
}

export interface CodiceIva extends DatiCodiceIva, Versionata {}

export type NuovoCodiceIva = Omit<DatiCodiceIva, 'attivo'> & { attivo?: boolean }

export type ModificaCodiceIva = Partial<DatiCodiceIva> & { versione: number }

// --- Codifiche di addebito --------------------------------------------------------------------

export type GenereCodificaAddebito =
  | 'GRUPPO'
  | 'CATEGORIA'
  | 'CATEGORIA_STATISTICA_1'
  | 'CATEGORIA_STATISTICA_2'
  | 'CENTRO_RICAVO'

export interface CodificaAddebito extends Versionata {
  genere: GenereCodificaAddebito
  /** Tre cifre (`007`). */
  codice: string
  descrizione: string
  attiva: boolean
}

/** Codice omesso = primo codice libero del genere (aggiunta in linea). */
export interface NuovaCodificaAddebito {
  genere: GenereCodificaAddebito
  descrizione: string
  codice?: string | null
}

/** Il genere si sceglie alla creazione e non cambia più. */
export interface ModificaCodificaAddebito {
  codice?: string
  descrizione?: string
  attiva?: boolean
  versione: number
}

// --- Archivio addebiti ------------------------------------------------------------------------

export type TipoProvvigione = 'SCONTATO' | 'LORDO'

export type NumeroListino = 1 | 2 | 3 | 4 | 5 | 6

export interface PrezzoListino {
  numero: NumeroListino
  prezzo: string | null
  /** Cascata di percentuali (`10+5`). */
  sconto: string | null
  provvigione: string | null
}

export interface RiferimentoCodifica {
  id: string
  codice: string
  descrizione: string
}

export interface Addebito {
  id: string
  codice: string
  descrizione: string
  gruppo: RiferimentoCodifica
  unitaMisura: string
  codiceIva: RiferimentoCodifica | null
  tipo: string
  etichettaTipo: string
  categoria: RiferimentoCodifica | null
  tipoProvvigione: TipoProvvigione
  centroRicavo: RiferimentoCodifica | null
  categoriaStatistica1: RiferimentoCodifica | null
  categoriaStatistica2: RiferimentoCodifica | null
  notaUsoInterno: string | null
  appunti: string | null
  /** Sempre sei, per numero. */
  listini: PrezzoListino[]
  attivo: boolean
  versione: number
  eliminabile: boolean
}

export interface DatiAddebito {
  /** Vuoto = lo assegna il server (aggiunta in linea). */
  codice?: string | null
  descrizione: string
  gruppoId: string
  unitaMisura: string
  codiceIvaId?: string | null
  tipo: string
  categoriaId?: string | null
  tipoProvvigione: TipoProvvigione
  centroRicavoId?: string | null
  categoriaStatistica1Id?: string | null
  categoriaStatistica2Id?: string | null
  notaUsoInterno?: string | null
  appunti?: string | null
  listini: PrezzoListino[]
  attivo?: boolean
}

export type ModificaAddebito = Partial<DatiAddebito> & { versione: number }

export interface FiltroAddebiti {
  testo?: string
  tipo?: string
  soloAttivi?: boolean
  pagina?: number
  dimensione?: number
}

// --- Variazione dei prezzi dell'archivio (E22) ------------------------------------------------

export type TipoVariazione =
  | 'AUMENTO_PERCENTUALE'
  | 'AUMENTO_IMPORTO'
  | 'DIMINUZIONE_PERCENTUALE'
  | 'DIMINUZIONE_IMPORTO'
  | 'SOSTITUZIONE_IVA'

export interface FiltroVariazioneArchivio {
  addebitiIds?: string[]
  categorieIds?: string[]
  tipi?: string[]
  listini?: NumeroListino[]
}

export interface CorpoVariazione<F = FiltroVariazioneArchivio> {
  tipo: TipoVariazione
  /** Stringa decimale (R12). */
  valore?: string
  daCodiceIvaId?: string
  aCodiceIvaId?: string
  filtri: F
}

export interface AnteprimaVariazione {
  totale: number
  righe: { id: string; descrizione: string; listino?: number; prima: string; dopo: string }[]
  errori: { id: string; descrizione: string; messaggio: string }[]
  impronta: string
}

/** Risposta dell'applicazione della variazione (R24). */
export interface EsitoVariazione {
  aggiornati: number
}
