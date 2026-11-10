/**
 * Tipi d'ingresso e d'uscita dell'aggregatore O.R.SO. (scheda impianti, modalità normale).
 * Il lettore Prisma (49-t3) produce `MovimentoOrso`; il serializzatore XML (49-t2) consuma un
 * tipo ricalcato sull'XSD: il coordinatore allinea `AggregatoOrso` a `ImpiantoMesiDati`.
 */

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
}

export type CodiceAvvisoOrso =
  | 'PROVINCIA_CONFERITORE_MANCANTE'
  | 'QUANTITA_NON_CONVERTIBILE'
  | 'OPERAZIONE_MANCANTE'
  | 'TRATTATO_INTERNAMENTE_DEFAULT'

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
  /** tonnellate trattate internamente: 0 finché il registro non le ha */
  trattatoInternamente: string
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
