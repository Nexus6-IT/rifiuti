/**
 * Dati di ingresso del serializzatore XML `ImpiantoMesi` (O.R.SO. Lombardia), ricalcati sull'XSD
 * `https://orso.arpalombardia.it/schemi/ImpiantoMesi.xsd`. Le quantità sono stringhe decimali in
 * tonnellate con il punto (mai numeri JS: niente notazione esponenziale né errori di arrotondamento).
 */

/** Tipo di soggetto conferitore (`tTipoSoggettoIn`): comune, impianto, impianto nuovo, totale, extra-regione. */
export type TipoSoggettoIn = 'C' | 'I' | 'Inew' | 'Tot' | 'Extra'

/** Tipo di soggetto destinatario (`tTipoSoggettoOut`). */
export type TipoSoggettoOut = 'I' | 'Inew' | 'Tot'

/** Singolo movimento in ingresso (`In`). */
export interface IngressoDati {
  /** Tonnellate, decimale con il punto, >= 0. */
  q: string
  /** 1 se il trasporto è avvenuto con FIR. */
  f: 0 | 1
  ts: TipoSoggettoIn
  /** Identificativo del soggetto: da 1 a 9 cifre. Per `Tot` ed `Extra` si usa `0`. */
  s: string
}

/** Singolo movimento in uscita (`Out`). */
export interface UscitaDati {
  /** Tonnellate, decimale con il punto, > 0. */
  q: string
  ts: TipoSoggettoOut
  /** Intero >= 0. Per `Tot` si usa `0`. */
  s: string
}

export interface RifiutoRicevutoDati {
  /** Sei cifre. */
  cer: string
  /** 1-100 caratteri (già troncata dall'aggregatore). */
  descrizione: string
  /** R1-R13 e D1-D15, ripetibile. */
  operazioni: string[]
  /** Quantità trattata (facoltativa), tonnellate. */
  trattato?: string
  ingressi: IngressoDati[]
}

export interface RifiutoProdottoDati {
  cer: string
  descrizione: string
  /** Tonnellate, può essere `0`. */
  quantitaTrattataInternamente: string
  uscite: UscitaDati[]
}

export interface MeseDati {
  /** 1-12. */
  mese: number
  ricevuti: RifiutoRicevutoDati[]
  prodotti: RifiutoProdottoDati[]
}

export interface AnnoDati {
  anno: number
  mesi: MeseDati[]
}

export interface ImpiantoMesiDati {
  /** Nome del software (attributo `autore`, facoltativo). */
  autore?: string
  anni: AnnoDati[]
}
