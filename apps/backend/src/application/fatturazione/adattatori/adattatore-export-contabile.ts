// Interfaccia degli adattatori dell'export contabile (4.4c, Task 29, spec §7.3). Un adattatore
// traduce i documenti di fatturazione nel formato di un gestionale contabile (file o API). La 4.4c
// consegna l'interfaccia completa, anche per la 4.4d (adattatori in modalita' API): `invia` e
// `credenziali` non hanno ancora chiamanti.
import type { DocumentoPerExport } from '../export-csv'

/** Che cosa si mappa: il tipo della chiave di WasteFlow. Estenderlo vuole una migration (CHECK). */
export const TIPI_MAPPATURA = [
  'CODICE_IVA',
  'CONTO_RICAVI',
  'CLIENTE',
  'PAGAMENTO',
  'REGISTRO',
] as const
export type TipoMappatura = (typeof TIPI_MAPPATURA)[number]

/** Una chiave che i documenti scelti richiedono e che l'azienda non ha ancora mappato. */
export interface ChiaveMancante {
  tipo: TipoMappatura
  chiaveWasteflow: string
  /** Testo per l'utente (per esempio «IVA 22%»): mai l'identificativo grezzo. */
  etichetta: string
}

/** Formato del valore di una mappatura: un codice numerico di al massimo `massimo` cifre. */
export interface FormatoMappatura {
  soloCifre: true
  massimo: number
}

export interface FileGenerato {
  nome: string
  contentType: string
  contenuto: Buffer
}

export interface EsitoInvio {
  documentoId: string
  ok: boolean
  riferimento?: string
  errore?: string
}

/** Chiave di una voce nella mappa passata all'adattatore: `<tipo>:<chiaveWasteflow>`. */
export const chiaveMappatura = (tipo: TipoMappatura, chiaveWasteflow: string): string =>
  `${tipo}:${chiaveWasteflow}`

export interface AdattatoreExportContabile {
  /** Identifica l'adattatore nelle rotte e nelle mappature (al massimo 30 caratteri). */
  readonly codice: string
  readonly nome: string
  readonly modalita: 'FILE' | 'API'
  /**
   * `false` = «tracciato non verificato su un'installazione reale» (decisione 15): le pagine di
   * export lo mostrano all'utente.
   */
  readonly verificato: boolean
  /**
   * Le chiavi di WasteFlow che i documenti usano e che l'adattatore sa tradurre. Ogni
   * `chiaveWasteflow` ha al massimo 100 caratteri (colonna e DTO): una chiave piu' lunga non si
   * potrebbe mappare e l'export resterebbe in 409.
   */
  /**
   * Formato atteso del valore di una mappatura, per tipo: se presente, `MappatureService.imposta`
   * rifiuta (400 `VOCI_NON_VALIDE`) un valore diverso da un codice di sole cifre, di al massimo
   * `massimo` cifre. Cosi' l'errore esce quando l'ADMIN compila la mappatura e non all'export.
   */
  readonly formatiMappature?: Partial<Record<TipoMappatura, FormatoMappatura>>
  mappatureRichieste(documenti: readonly DocumentoPerExport[]): ChiaveMancante[]
  /**
   * Modalita' FILE: genera i file. Le `mappature` hanno chiave `chiaveMappatura(tipo, chiave)`.
   * Funzione pura e sincrona: non legge ne' scrive nulla, cosi' un errore non lascia effetti.
   */
  genera?(
    documenti: readonly DocumentoPerExport[],
    mappature: ReadonlyMap<string, string>
  ): FileGenerato[]
  /** Modalita' API (4.4d): invia i documenti al gestionale. */
  invia?(
    documenti: readonly DocumentoPerExport[],
    mappature: ReadonlyMap<string, string>,
    credenziali: unknown
  ): Promise<EsitoInvio[]>
}

/** Token del provider multi del modulo: l'elenco di tutti gli adattatori registrati. */
export const ADATTATORI_EXPORT = Symbol('ADATTATORI_EXPORT')
