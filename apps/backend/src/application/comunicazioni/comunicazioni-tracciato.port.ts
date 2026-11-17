import type { AffidabilitaTracciato } from '../../domain/comunicazioni/tracciato-comunicazione'
import type {
  ConfigurazionePerConsorzio,
  ConsorzioConfigurabile,
} from '../../domain/comunicazioni/configurazione-sede'
import type { TracciatoDati } from '../../domain/comunicazioni/dati-tracciato'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import type { AvvisoOrso, ComunicazioneVista } from './comunicazioni-orso.port'
import type { DettagliTracciato } from './lettore-dettagli-tracciato'
import type { MovimentoOrso } from './lettore-movimenti-orso'

/**
 * Servizio generico «comunicazione a tracciato» (4.9c-f, A5): anteprima, genera, file, manifest,
 * segna inviata e storico per i tracciati a record (CONOU, COBAT, O.R.R.), sopra
 * `ComunicazioneConsorzio` di 4.9a. Ogni tracciato vi si aggancia con un PREPARATORE.
 */
export const COMUNICAZIONI_TRACCIATO_SERVICE = Symbol('COMUNICAZIONI_TRACCIATO_SERVICE')
export const PREPARATORI_TRACCIATO = Symbol('PREPARATORI_TRACCIATO')
export const REGISTRO_TRACCIATI = Symbol('REGISTRO_TRACCIATI')

/** Dove si corregge un avviso (D14): l'interfaccia ne fa un link. */
export type CorrezioneAvviso =
  | { tipo: 'MOVIMENTO' }
  | { tipo: 'ANAGRAFICA_SEDE'; sedeDittaId: string }
  | { tipo: 'CONFIGURAZIONE_SEDE' }

export interface AvvisoTracciato extends AvvisoOrso {
  bloccante: boolean
  correzione?: CorrezioneAvviso
  /** Campo dei dati a cui l'avviso si riferisce (es. `righe[2].prodotto`), se ce n'e' uno. */
  campo?: string
}

export interface UnitaPropria {
  id: string
  denominazione: string
  numIscrSito: string
  indirizzo: string | null
  civico: string | null
  cap: string | null
  comune: string | null
  provincia: string | null
  progressivoMud: number | null
}

export interface AziendaPropria {
  partitaIva: string
  codiceFiscale: string | null
  ragioneSociale: string
  atecoCode: string | null
  legaleRappresentanteCognome: string | null
  legaleRappresentanteNome: string | null
}

export interface ContestoPreparazione<C = unknown> {
  tenantId: string
  azienda: AziendaPropria
  unita: UnitaPropria
  /** Periodo incluso, `AAAA-MM-GG`. */
  periodo: { da: string; a: string }
  /** Parametri specifici del tracciato (es. l'attivita' del file O.R.R.). */
  parametri: Readonly<Record<string, string>>
  /** Movimenti vigenti del periodo, gia' filtrati dalla selezione del preparatore. */
  movimenti: ReadonlyArray<MovimentoOrso>
  dettagli: DettagliTracciato
  configurazione: C
  catalogo: CatalogoCausali
}

export interface PreparazioneTracciato<D> {
  dati: D
  avvisi: AvvisoTracciato[]
  /** Movimenti che entrano nel file: ne resta l'istantanea con i kg. */
  movimentiInFile: ReadonlyArray<MovimentoOrso>
}

/** Come un tracciato sceglie i movimenti del periodo. */
export type SelezioneMovimenti =
  /** Solo quelli marcati per il consorzio dal classificatore 4.9b (regole + correzioni). */
  | { tipo: 'MARCATI'; consorzio: 'CONOU' | 'COBAT' | 'COREPLA' }
  /** Tutti i movimenti vigenti della sede. */
  | { tipo: 'TUTTI' }

/**
 * Contratto del preparatore (vincoli per chi ne scrive uno):
 * - `prepara` deve essere DETERMINISTICO: stessi input, stessi `dati` con le chiavi create sempre
 *   nello stesso ordine (l'hash e' lo SHA-256 di `JSON.stringify(dati)`: niente `Object.assign` di
 *   oggetti con chiavi variabili, niente `undefined` che compare e scompare).
 * - Tutto cio' che influenza `dati` oltre a periodo, sede e movimenti DEVE passare dai parametri
 *   della richiesta e ritornare da `parametriDaTracciato(nomeTracciato)`: il ricalcolo di una
 *   comunicazione salvata («modificata dopo l'invio», manifest) ricostruisce i parametri solo da li'.
 * - Il servizio generico blocca da se' i caratteri fuori da Windows-1252 (avviso
 *   `CARATTERI_NON_RAPPRESENTABILI`, con campo e movimento): il preparatore puo' comunque
 *   segnalarli prima, con un messaggio piu' specifico.
 * - Per avere l'avviso collegato al movimento, i dati per movimento portano `movimentoId` (o
 *   `movimentoIds`), vedi `cercaCampiNonRappresentabili`.
 */
export interface PreparatoreTracciato<D = unknown, C = unknown> {
  /** Consorzio e versione del tracciato nel `RegistroTracciati`. */
  readonly consorzio: string
  readonly versione: string
  /** Valore della colonna `tracciato` di `comunicazioni_consorzi`. */
  nomeTracciato(parametri: Readonly<Record<string, string>>): string
  readonly selezione: SelezioneMovimenti
  /** Consorzio della configurazione di sede; `null` se il tracciato non ne usa. */
  readonly configurazione: ConsorzioConfigurabile | null
  /** Dati del tracciato per movimento da leggere (CONOU, COBAT, ORR), se serve. */
  readonly datiTracciato?: TracciatoDati
  /** Differenze volute rispetto a WinWaste, per il manifest. */
  readonly differenzeDaWinWaste: readonly string[]
  /** Inferenze usate, per il manifest. */
  readonly inferenze: readonly string[]
  /** Errori di richiesta (periodo, parametri): lista vuota se valida. */
  validaRichiesta?(richiesta: RichiestaComunicazione): string[]
  prepara(ctx: ContestoPreparazione<C>): Promise<PreparazioneTracciato<D>>
  nomeFile(
    ctx: {
      unita: UnitaPropria
      periodo: { da: string; a: string }
      parametri: Readonly<Record<string, string>>
    },
    dati: D
  ): string
  contaRecord(dati: D): number
  /** Ricava i parametri dal valore salvato in `tracciato` (per rigenerare il manifest). */
  parametriDaTracciato?(tracciato: string): Record<string, string>
}

export interface RichiestaComunicazione {
  consorzio: string
  unitaLocaleId: string
  /** Periodo incluso, `AAAA-MM-GG`. */
  da: string
  a: string
  parametri?: Record<string, string>
}

export interface AnteprimaTracciato {
  unitaLocale: { id: string; nome: string }
  consorzio: string
  periodo: { da: string; a: string }
  tracciato: string
  versione: string
  affidabilita: AffidabilitaTracciato
  notaAffidabilita: string
  numeroRecord: number
  numeroMovimenti: number
  avvisi: AvvisoTracciato[]
  bloccanti: boolean
  hashDati: string
  ultima?: ComunicazioneTracciatoVista
}

export interface ComunicazioneTracciatoVista extends ComunicazioneVista {
  affidabilita: AffidabilitaTracciato
  notaAffidabilita: string
}

export interface FileTracciato {
  nomeFile: string
  contenuto: Buffer
  contentType: string
}

export interface ComunicazioniTracciatoPort {
  anteprima(tenantId: string, richiesta: RichiestaComunicazione): Promise<AnteprimaTracciato>
  genera(
    tenantId: string,
    utenteId: string,
    richiesta: RichiestaComunicazione
  ): Promise<ComunicazioneTracciatoVista>
  elenca(
    tenantId: string,
    filtri: { consorzio?: string; unitaLocaleId?: string; da?: string; a?: string }
  ): Promise<ComunicazioneTracciatoVista[]>
  file(tenantId: string, id: string): Promise<FileTracciato>
  /** Consorzio della comunicazione (serve a instradare `segna inviata`); lancia se non trovata. */
  consorzioDi(tenantId: string, id: string): Promise<string>
  manifest(tenantId: string, id: string): Promise<{ nomeFile: string; testo: string }>
  /**
   * Segna la comunicazione come inviata. Per i tracciati ricavati da WinWaste serve
   * `confermaVerifica = true` («Ho verificato che il consorzio accetta questo file»).
   */
  segnaInviata(
    tenantId: string,
    utenteId: string,
    id: string,
    confermaVerifica?: boolean
  ): Promise<ComunicazioneTracciatoVista>
}

/** Richiesta non valida (consorzio, periodo, parametri): risponde 400. */
export class RichiestaComunicazioneNonValidaError extends Error {
  constructor(readonly errori: string[]) {
    super(`Richiesta non valida: ${errori.join('; ')}`)
    this.name = 'RichiestaComunicazioneNonValidaError'
  }
}

/** Per un tracciato ricavato da WinWaste serve la conferma esplicita: risponde 400. */
export class ConfermaVerificaRichiestaError extends Error {
  constructor() {
    super(
      'Il tracciato e’ ricavato da WinWaste e non e’ stato verificato con il consorzio: conferma di aver verificato che il consorzio accetta questo file.'
    )
    this.name = 'ConfermaVerificaRichiestaError'
  }
}

/**
 * Il contenuto salvato non si puo' codificare nella codifica del tracciato (carattere fuori da
 * Windows-1252): dati storici non piu' scaricabili. Risponde 422.
 */
export class FileNonCodificabileError extends Error {
  constructor(readonly dettaglio: string) {
    super(`Il file non si puo’ scaricare: ${dettaglio}`)
    this.name = 'FileNonCodificabileError'
  }
}

/** Il tracciato della comunicazione non e' piu' nel registro: la codifica non si indovina. 422. */
export class TracciatoNonDisponibileError extends Error {
  constructor(tracciato: string, versione: string) {
    super(
      `Il tracciato ${tracciato} (versione ${versione}) non e’ piu’ disponibile: il file non si puo’ scaricare con la codifica giusta.`
    )
    this.name = 'TracciatoNonDisponibileError'
  }
}

export type { ConfigurazionePerConsorzio }
