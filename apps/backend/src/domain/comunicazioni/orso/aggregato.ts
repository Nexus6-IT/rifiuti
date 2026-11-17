/**
 * Tipi d'ingresso e d'uscita dell'aggregatore O.R.SO. (scheda impianti, modalità normale).
 * Il lettore Prisma (49-t3) produce `MovimentoOrso`; il serializzatore XML (49-t2) consuma un
 * tipo ricalcato sull'XSD: il coordinatore allinea `AggregatoOrso` a `ImpiantoMesiDati`.
 */

import type { NuovoImpiantoDati } from './impianto-mesi'

export type VersoMovimentoOrso = 'CARICO' | 'SCARICO'

/** Movimento vigente della sede, già risolto dal lettore (ruolo, operazione, FIR, provincia). */
export interface MovimentoOrso {
  id: string
  /** 1-12, mese del movimento nel fuso italiano */
  mese: number
  verso: VersoMovimentoOrso
  /** `ruoloMud` della causale: i carichi contano solo se RICEVUTO_DA_TERZI, gli scarichi se non ESCLUSO */
  ruoloMud: string
  cer: string
  descrizione: string | null
  quantita: number
  unita: string | null
  /** kg per unità di misura non di massa (peso specifico del MUD); null se non noto */
  kgPerUnita: number | null
  /** codice operazione R1-R13 / D1-D15 (movimento o catalogo), null se assente */
  operazione: string | null
  conFir: boolean
  /** sigla provincia del conferitore (carichi); null se non risolvibile */
  provinciaConferitore: string | null
  /**
   * Soggetto conferitore (carichi) o destinatario (scarichi), solo per la modalità dettagliata
   * (4.9e). `null` o assente = non identificato. Ignorato dalla modalità normale.
   */
  soggetto?: SoggettoOrso | null
}

/** Anagrafica di un nuovo impianto, senza il progressivo `id` (lo assegna l'aggregatore). */
export type ImpiantoNuovoOrso = Omit<NuovoImpiantoDati, 'id'>

/**
 * Soggetto di un movimento in modalità dettagliata: comune (`C`, solo conferitori), impianto
 * dell'elenco ARPA (`I`) o nuovo impianto (`Inew`, descritto per esteso). `chiave` identifica lo
 * stesso soggetto fra movimenti diversi (es. l'id della sede della ditta).
 */
export type SoggettoOrso =
  | { tipo: 'C'; istat: string; etichetta?: string }
  | { tipo: 'I'; codice: string; etichetta?: string }
  | { tipo: 'Inew'; chiave: string; impianto: ImpiantoNuovoOrso }

export type CodiceAvvisoOrso =
  | 'PROVINCIA_CONFERITORE_MANCANTE'
  | 'QUANTITA_NON_CONVERTIBILE'
  | 'OPERAZIONE_MANCANTE'
  | 'GIACENZA_NEGATIVA'
  | 'SOGGETTO_NON_IDENTIFICATO'

/** Giacenza del CER a fine mese, calcolata dal registro (carichi - scarichi vigenti, aperture). */
export interface GiacenzaFineMeseOrso {
  /** 1-12 */
  mese: number
  cer: string
  /** descrizione per il nodo se il CER non ha uscite nel mese; null = nessuna disponibile */
  descrizione: string | null
  kg: number
}

export interface AvvisoOrso {
  codice: CodiceAvvisoOrso
  bloccante: boolean
  mese: number
  cer: string
  /** movimenti coinvolti, in ordine di id */
  movimentoIds: string[]
}

export interface RifiutoRicevutoOrso {
  cer: string
  descrizione: string
  /** codici operazione distinti, ordinati */
  operazioni: string[]
  /** tonnellate, stringa decimale con punto */
  totale: string
  extra: string
  f: 0 | 1
}

export interface RifiutoProdottoOrso {
  cer: string
  descrizione: string
  /** tonnellate prodotte (Out Tot) */
  totale: string
  /**
   * Tonnellate in giacenza a fine mese: l'attributo `QuantitaTrattataInternamente` di O.R.SO.
   * indica «in realtà la giacenza a fine mese» (guida v2.5, pag. 17).
   */
  giacenzaFineMese: string
}

export interface MeseOrso {
  mese: number
  ricevuti: RifiutoRicevutoOrso[]
  prodotti: RifiutoProdottoOrso[]
}

export interface AggregatoOrso {
  anno: number
  /** solo i mesi con almeno un nodo, in ordine */
  mesi: MeseOrso[]
  avvisi: AvvisoOrso[]
  /** almeno un avviso bloccante */
  bloccato: boolean
}

/** Ingresso per soggetto (modalità dettagliata). `s` per `Inew` è il progressivo del `NuovoImpianto`. */
export interface IngressoSoggettoOrso {
  ts: 'C' | 'I' | 'Inew'
  s: string
  /** Testo per l'anteprima: ragione sociale, codice ARPA o ISTAT del comune. */
  etichetta: string
  /** tonnellate, stringa decimale con punto */
  totale: string
  /** 1 se almeno un movimento di questo soggetto nel nodo ha il FIR (review 4.9a, M3) */
  f: 0 | 1
}

export interface UscitaSoggettoOrso {
  ts: 'I' | 'Inew'
  s: string
  etichetta: string
  totale: string
}

export interface RifiutoRicevutoDettagliato extends RifiutoRicevutoOrso {
  ingressi: IngressoSoggettoOrso[]
}

export interface RifiutoProdottoDettagliato extends RifiutoProdottoOrso {
  uscite: UscitaSoggettoOrso[]
}

export interface MeseOrsoDettagliato {
  mese: number
  ricevuti: RifiutoRicevutoDettagliato[]
  prodotti: RifiutoProdottoDettagliato[]
}

/** Uscita dell'aggregatore dettagliato: stessi nodi del normale, con il dettaglio per soggetto. */
export interface AggregatoOrsoDettagliato {
  anno: number
  mesi: MeseOrsoDettagliato[]
  avvisi: AvvisoOrso[]
  bloccato: boolean
  /** Nuovi impianti numerati per prima comparsa (ordine del file), da scrivere come `NuovoImpianto`. */
  nuoviImpianti: NuovoImpiantoDati[]
}
