/**
 * Porta dei dati di una sede di ditta per le comunicazioni ai consorzi (4.9c-f, D3): ATECO, ISTAT,
 * codice ARPA, estremi Albo e autorizzazione, legale rappresentante.
 */
export const ANAGRAFICA_COMUNICAZIONI_SERVICE = Symbol('ANAGRAFICA_COMUNICAZIONI_SERVICE')

export interface AnagraficaComunicazioniVista {
  sedeDittaId: string
  eComune: boolean
  codiceIstatComune: string | null
  codiceAteco: string | null
  codiceOrso: string | null
  /** `AAAA-MM-GG`. */
  alboDataIscrizione: string | null
  alboClassi: string | null
  /** `AAAA-MM-GG`. */
  autorizzazioneData: string | null
  legaleRappresentanteCognome: string | null
  legaleRappresentanteNome: string | null
  esclusaOrr: boolean
}

/** Sostituisce l'intera anagrafica: i campi omessi tornano al valore di partenza (vuoto, `false`). */
export interface InputAnagraficaComunicazioni {
  eComune?: boolean
  codiceIstatComune?: string | null
  codiceAteco?: string | null
  codiceOrso?: string | null
  alboDataIscrizione?: string | null
  alboClassi?: string | null
  autorizzazioneData?: string | null
  legaleRappresentanteCognome?: string | null
  legaleRappresentanteNome?: string | null
  esclusaOrr?: boolean
}

export type RisoluzioneIstat =
  | { codice: string; origine: 'FORZATO' | 'DA_NOME' }
  | {
      codice: null
      motivo: 'COMUNE_NON_TROVATO' | 'COMUNE_AMBIGUO' | 'COMUNE_O_PROVINCIA_MANCANTE'
    }

export interface AnagraficaComunicazioniPort {
  /** Anagrafica della sede; senza riga salvata restituisce i valori di partenza. */
  leggi(tenantId: string, sedeDittaId: string): Promise<AnagraficaComunicazioniVista>
  imposta(
    tenantId: string,
    sedeDittaId: string,
    input: InputAnagraficaComunicazioni
  ): Promise<AnagraficaComunicazioniVista>
  /** Codice ISTAT a 6 cifre: forzatura salvata, altrimenti comune e provincia della sede. */
  risolviIstat(tenantId: string, sedeDittaId: string): Promise<RisoluzioneIstat>
}

/** Dati non validi: risponde 400, con l'elenco degli errori. */
export class AnagraficaComunicazioniNonValidaError extends Error {
  constructor(readonly errori: string[]) {
    super(`Dati non validi: ${errori.join('; ')}`)
    this.name = 'AnagraficaComunicazioniNonValidaError'
  }
}

export class SedeDittaNonTrovataError extends Error {
  constructor() {
    super('Sede non trovata.')
    this.name = 'SedeDittaNonTrovataError'
  }
}
