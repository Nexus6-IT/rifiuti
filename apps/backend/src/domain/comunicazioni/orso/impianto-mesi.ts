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

/** Indirizzo di un nuovo impianto (`tIndirizzo`). Provincia e comune sono i codici ISTAT a 3 cifre. */
export interface IndirizzoDati {
  /** Tipo di via (es. «Via»), 1-10 caratteri. */
  tipo?: string
  /** Nome della via, 1-100 caratteri. */
  nome?: string
  /** Numero civico: l'XSD ammette 10 caratteri, qui 5 come WinWaste (`Civico` troncato a 5). */
  civico?: string
  /** Cinque cifre. */
  cap?: string
  /** ISTAT provincia, 3 cifre (`000` per l'estero). */
  provincia: string
  /** ISTAT comune, 3 cifre (per l'estero il codice ISO numerico). */
  comune: string
}

/**
 * Soggetto non presente nell'elenco ARPA, descritto per esteso nel file (`NuovoImpianto`).
 * L'`id` coincide con l'identificativo `s` degli `In`/`Out` con `ts="Inew"`.
 */
export interface NuovoImpiantoDati {
  id: number
  /** 1-255 caratteri. */
  ragioneSociale: string
  /** Forma societaria, 1-10 caratteri (facoltativa). */
  formaSocietaria?: string
  /** Codice fiscale o partita IVA, 11-16 caratteri alfanumerici. */
  codfisPiva: string
  indirizzoSL?: IndirizzoDati
  indirizzoUL: IndirizzoDati
}

export interface ImpiantoMesiDati {
  /** Nome del software (attributo `autore`, facoltativo). */
  autore?: string
  anni: AnnoDati[]
  /** Nuovi impianti (modalità dettagliata, 4.9e); assenti in modalità normale. */
  nuoviImpianti?: NuovoImpiantoDati[]
}
