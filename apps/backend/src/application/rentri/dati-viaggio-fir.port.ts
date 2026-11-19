/**
 * Porta dei dati di viaggio di un FIR che l'aggregate non porta (FIR in viaggio, P2): campi di
 * `QuantitaRifiutoModel` (`verificato_in_partenza`, `rinfusa`) e dati di trasporto della tratta PRINCIPALE
 * (conducente, rimorchio, percorso). Stanno su colonne dedicate di `firs`, fuori dall'hash di integrita'
 * e dal documento firmato, e si leggono/scrivono qui per non appesantire l'aggregate e il suo `save`.
 *
 * Le due scritture `...DopoEnte` si chiamano SOLO dopo l'esito positivo dell'ente: la copia locale segue
 * il formulario, mai il contrario.
 */

export interface DatiTrasportoTrattaLocale {
  conducenteNome: string | null
  conducenteCognome: string | null
  targaRimorchio: string | null
  percorso: string | null
}

export interface TrattaAggiuntivaViaggio extends DatiTrasportoTrattaLocale {
  ordine: number
  /** `TERRESTRE`, `FERROVIARIA` o `MARITTIMA`. */
  tipoTratta: string
  denominazione: string
  partitaIva: string | null
  codiceFiscale: string | null
  numeroIscrizioneAlbo: string | null
  /** Targa, numero treno o nome nave. */
  mezzo: string | null
  dataOraInizioTrasporto: Date | null
}

export interface DatiViaggioFir {
  firId: string
  quantita: number
  /** Unita' del FIR (`kg`, `litri`, `t`). */
  unitaMisura: string
  numeroColli: number | null
  verificatoInPartenza: boolean | null
  rinfusa: boolean | null
  /** Data indicata per il trasporto, fissata alla creazione: e' l'inizio del trasporto della tratta principale. */
  dataTrasporto: Date
  /** Targa dell'automezzo della tratta principale (vuota se non indicata). */
  targaAutomezzo: string
  principale: DatiTrasportoTrattaLocale
  tratteAggiuntive: TrattaAggiuntivaViaggio[]
}

/** `undefined` = non toccare; `null` = svuota. */
export interface DatiPartenzaDaSalvare {
  verificatoInPartenza?: boolean | null
  rinfusa?: boolean | null
  conducenteNome?: string | null
  conducenteCognome?: string | null
  targaRimorchio?: string | null
  percorso?: string | null
}

export interface QuantitaInviata {
  valore: number
  unitaMisura: string
  numeroColli: number | null
  rinfusa: boolean
  verificatoInPartenza: boolean | null
}

export interface TrasportoInviato {
  targaAutomezzo: string | null
  conducenteNome: string
  conducenteCognome: string
  targaRimorchio: string | null
  percorso: string | null
}

/** Conducente e rimorchio dell'ultimo trasporto di un automezzo, per precompilare il form (decisione D3). */
export interface UltimoTrasportoAutomezzo {
  conducenteNome: string
  conducenteCognome: string
  targaRimorchio: string | null
}

export abstract class IDatiViaggioFirRepository {
  /** L'ultimo FIR dell'azienda con quella targa e un conducente completo, se c'e'. */
  abstract ultimoTrasportoPerTarga(
    tenantId: string,
    targa: string
  ): Promise<UltimoTrasportoAutomezzo | null>
  abstract leggi(tenantId: string, firId: string): Promise<DatiViaggioFir | null>
  /** Alla creazione o alla modifica di una bozza: salva i dati noti del viaggio. */
  abstract salvaDatiPartenza(
    tenantId: string,
    firId: string,
    dati: DatiPartenzaDaSalvare
  ): Promise<void>
  /** Dopo l'esito positivo di `/quantita`: la quantita' locale segue quella dell'ente. */
  abstract aggiornaQuantitaDopoEnte(
    tenantId: string,
    firId: string,
    quantita: QuantitaInviata
  ): Promise<void>
  /** Dopo l'esito positivo di `/trasporto`: targa, conducente, rimorchio e percorso locali seguono l'ente. */
  abstract aggiornaTrasportoDopoEnte(
    tenantId: string,
    firId: string,
    trasporto: TrasportoInviato
  ): Promise<void>
}
