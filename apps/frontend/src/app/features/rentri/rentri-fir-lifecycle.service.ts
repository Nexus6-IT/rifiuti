import { Injectable } from '@angular/core'
import { HttpClient, HttpResponse } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Un'operazione RENTRI disponibile ORA su un formulario (v. backend `AzioneTradotta`). */
export interface AzioneRentri {
  operazione: string
  verbo: string
}

export interface AzioniDisponibiliResult {
  stato: string
  versione: number | null
  azioni: AzioneRentri[]
}

/** Payload di `POST /rentri/fir/:id/accettazione` (v. backend `AccettaFirRentriDto`). */
export interface AccettaFirRentriPayload {
  tipoAccettazione: 'A' | 'P' | 'R'
  dataOraArrivo?: string
  quantitaAccettataKg?: number
  causaleRespingimento?: 'NC' | 'IR' | 'A'
  motivoRespingimento?: string
  attesaVerificaAnalitica?: boolean
  correlationId?: string
}

/** Esito della firma remota (unione discriminata, v. backend `EsitoCompletamentoFirma`). */
export type EsitoFirmaRemota =
  | { esito: 'COMPLETATA'; statoFormulario: string }
  | { esito: 'IN_ATTESA'; handle: string; sessioneId?: string; scadenzaAutorizzazione: string }
  | {
      esito: 'SCADUTA'
      handle: string
      sessioneId?: string
      rilevataDa: 'ente' | 'orologio-locale'
      dettaglioEnte?: string
    }
  | { esito: 'RIFIUTATA'; handle: string; sessioneId?: string; dettaglioEnte?: string }

/**
 * Sessione di firma in attesa di conferma sul dispositivo (FIR in viaggio, P1): mai token, digest o
 * handle, solo quanto serve al banner.
 */
export interface SessioneFirmaInAttesa {
  id: string
  tipoOperazione: string
  scadenza: string
  /** IN_ATTESA = da confermare; SCADUTA/RIFIUTATA = chiusa ma ancora visibile per riprovare o annullare. */
  stato: 'IN_ATTESA' | 'SCADUTA' | 'RIFIUTATA'
  /** Non si puo' riprendere (chiusa o limite passato): si chiede una nuova firma. */
  scaduta: boolean
}

/** Esito di `POST /rentri/fir/:id/firma-partenza` (FIR in viaggio, P3). */
export interface EsitoFirmaPartenza {
  /** L'operazione che l'ente ha proposto e che si e' firmata (produttore, trasportatore o entrambi). */
  operazione:
    | 'AcquisizioneFirmaProduttoreTrasportatore'
    | 'AcquisizioneFirmaProduttore'
    | 'AcquisizioneFirmaTrasportatore'
  firma: EsitoFirmaRemota
}

/** Le operazioni di `/azioni` che sono una firma di partenza. */
export const OPERAZIONI_FIRMA_PARTENZA: readonly string[] = [
  'AcquisizioneFirmaProduttoreTrasportatore',
  'AcquisizioneFirmaProduttore',
  'AcquisizioneFirmaTrasportatore',
]

/** Esito della firma proposta subito dopo l'annotazione: quelli del ciclo comune, piu' «da completare». */
export type EsitoFirmaAnnotazione =
  | EsitoFirmaRemota
  | { esito: 'DA_COMPLETARE'; codice?: string; avviso: string }

/** Esito di `POST /rentri/fir/:id/annotazione` (FIR in viaggio, P4). */
export interface EsitoAnnotazione {
  operazione: 'Annotazione'
  /** Stato riletto dall'ente dopo l'invio (`FirmaAnnotazione`); null se la rilettura non e' riuscita. */
  statoFormulario: string | null
  firma: EsitoFirmaAnnotazione
}

/** Limite del contratto RENTRI per il testo di un'annotazione (caratteri). */
export const ANNOTAZIONE_RENTRI_MAX = 10000

/** Esito della firma proposta subito dopo la sosta tecnica: quelli del ciclo comune, piu' «da completare». */
export type EsitoFirmaSostaTecnica = EsitoFirmaAnnotazione

/** Esito di `POST /rentri/fir/:id/sosta-tecnica` (FIR in viaggio, P5). */
export interface EsitoSostaTecnica {
  operazione: 'SostaTecnica'
  /** Stato riletto dall'ente dopo l'invio (`FirmaSostaTecnica`); null se la rilettura non e' riuscita. */
  statoFormulario: string | null
  firma: EsitoFirmaSostaTecnica
}

/** Corpo di `POST /rentri/fir/:id/sosta-tecnica`: istanti ISO 8601 in UTC (`Z`). */
export interface DatiSostaTecnica {
  luogoStazionamento: string
  dataOraSospensione: string
  dataOraRipresa: string
}

/** Limite del contratto RENTRI per il luogo di stazionamento (caratteri). */
export const LUOGO_SOSTA_RENTRI_MAX = 1000

/** Corpo di `POST /rentri/fir/:id/trasbordo-totale` (FIR in viaggio, P6): inizio in UTC (`Z`). */
export interface DatiTrasbordoTotale {
  /** Il NUOVO trasportatore, dall'anagrafica dell'azienda. */
  trasportatoreId: string
  conducenteNome: string
  conducenteCognome: string
  targaAutomezzo?: string
  targaRimorchio?: string
  percorso?: string
  dataOraInizioTrasporto: string
  presaInCaricoRimorchioPrecedente?: boolean
}

/**
 * Esito di `POST /rentri/fir/:id/trasbordo-totale`. La firma NON e' di chi invia ma del nuovo trasportatore:
 * da qui non parte nessuna richiesta di firma.
 */
export interface EsitoTrasbordoTotale {
  operazione: 'TrasbordoTotale'
  /** Stato riletto dall'ente dopo l'invio (`FirmaTrasbordoTotale`); null se la rilettura non e' riuscita. */
  statoFormulario: string | null
  /** `false` se l'ente ha accettato ma la nuova tratta del FIR non si e' potuta salvare qui. */
  trattaLocaleCreata: boolean
  firma: { esito: 'DA_FIRMARE_DAL_NUOVO_TRASPORTATORE'; avviso: string }
}

/** Esito di `POST /rentri/fir/:id/reset` e `/rollback-firma`. */
export interface EsitoRollbackOReset {
  operazione: 'RollbackFirma' | 'Reset'
  statoFormulario: string
  sessioneAnnullataId?: string
}

/** Payload di `POST /rentri/fir/:id/quantita` (v. backend `InviaQuantitaFirRentriDto`). */
export interface InviaQuantitaFirRentriPayload {
  quantita: number
  unitaMisura: string
  numeroColli?: number
  rinfusa?: boolean
  verificatoInPartenza?: boolean
  correlationId?: string
}

/** Payload di `POST /rentri/fir/:id/trasporto` (v. backend `InviaTrasportoFirRentriDto`). */
export interface InviaTrasportoFirRentriPayload {
  conducenteNome: string
  conducenteCognome: string
  targaAutomezzo?: string
  targaRimorchio?: string
  percorso?: string
  /** ISO 8601; se assente vale la data indicata sul FIR. */
  dataOraInizioTrasporto?: string
  annotazioni?: string
  correlationId?: string
}

/** Esito di `quantita` e `trasporto`: operazione usata e stato riletto dall'ente (null se la rilettura e' fallita). */
export interface EsitoInviaDatiViaggio {
  operazione: string
  statoFormulario: string | null
  /** false: l'ente ha accettato ma il dichiarato a RENTRI non e' stato salvato qui. */
  copiaLocaleAggiornata?: boolean
}

/** Una riga dello storico delle operazioni inviate all'ente (v. backend `EventoFirRentri`). */
export interface EventoFirRentri {
  id: string
  operazione: string
  esito: 'INVIATA' | 'ACCETTATA' | 'RIFIUTATA' | 'INCERTA'
  /** Corpo di dominio inviato all'ente (per l'annotazione: testo e CF del soggetto). */
  payload?: unknown
  dettaglioEnte: string | null
  statoFormularioDopo: string | null
  utenteId: string | null
  createdAt: string
}

/** Conducente e rimorchio dell'ultimo trasporto con una targa (precompila il form). */
export interface UltimoTrasportoAutomezzo {
  conducenteNome: string
  conducenteCognome: string
  targaRimorchio: string | null
}

export interface EsitoAccettaFirRentri {
  tipoAccettazione: 'A' | 'P' | 'R'
  esitoFirma: EsitoFirmaRemota
}

/** Payload di `POST /rentri/fir/:id/annullamento` (v. backend `AnnullaFirRentriDto`). */
export interface AnnullaFirRentriPayload {
  motivo: string
  correlationId?: string
}

export interface EsitoAnnullaFirRentri {
  esitoFirma: EsitoFirmaRemota
  noteInviate: boolean
}

/**
 * Payload di `POST /rentri/fir/:id/allegati` (v. backend
 * `CaricaAllegatoFirRentriDto`). NON porta `identificativoSoggetto`: il
 * backend lo risolve dal codice fiscale del tenant (v.
 * `GestisciAllegatiFIRUseCase`), non un valore che il frontend deve conoscere.
 */
export interface CaricaAllegatoFirRentriPayload {
  nomeFile: string
  contentType: string
  contenutoBase64: string
  correlationId?: string
}

/** Riga locale di un allegato (v. backend `AllegatoFIR`). */
export interface AllegatoFirRentri {
  id: string
  rentriAllegatoId: number
  filename: string
  mimeType: string
  sizeBytes: number
  caricatoDa: string
  caricatoAlle: string
}

/**
 * Client del ciclo di vita del formulario digitale RENTRI (R3): azioni
 * disponibili e accettazione/respingimento del carico. Backend:
 * `rentri-fir-lifecycle.controller.ts`.
 */
@Injectable({ providedIn: 'root' })
export class RentriFirLifecycleService {
  private readonly API_URL = `${environment.apiUrl}/rentri/fir`

  constructor(private http: HttpClient) {}

  azioniDisponibili(firId: string): Observable<AzioniDisponibiliResult> {
    return this.http.get<AzioniDisponibiliResult>(`${this.API_URL}/${firId}/azioni`)
  }

  accettaORespingi(
    firId: string,
    payload: AccettaFirRentriPayload
  ): Observable<EsitoAccettaFirRentri> {
    return this.http.post<EsitoAccettaFirRentri>(`${this.API_URL}/${firId}/accettazione`, payload)
  }

  annullaFIR(firId: string, payload: AnnullaFirRentriPayload): Observable<EsitoAnnullaFirRentri> {
    return this.http.post<EsitoAnnullaFirRentri>(`${this.API_URL}/${firId}/annullamento`, payload)
  }

  /** Indica o correggi la quantita' (FIR in viaggio, P2): la copia locale segue l'ente solo a esito positivo. */
  inviaQuantita(
    firId: string,
    payload: InviaQuantitaFirRentriPayload
  ): Observable<EsitoInviaDatiViaggio> {
    return this.http.post<EsitoInviaDatiViaggio>(`${this.API_URL}/${firId}/quantita`, payload)
  }

  /** Indica o correggi i dati del trasporto terrestre (FIR in viaggio, P2). */
  inviaTrasporto(
    firId: string,
    payload: InviaTrasportoFirRentriPayload
  ): Observable<EsitoInviaDatiViaggio> {
    return this.http.post<EsitoInviaDatiViaggio>(`${this.API_URL}/${firId}/trasporto`, payload)
  }

  /** Storico delle operazioni inviate all'ente, dal piu' recente (sola lettura). */
  eventi(firId: string): Observable<{ eventi: EventoFirRentri[] }> {
    return this.http.get<{ eventi: EventoFirRentri[] }>(`${this.API_URL}/${firId}/eventi`)
  }

  /** Conducente e rimorchio dell'ultimo trasporto fatto con quella targa (null se non c'e'). */
  ultimoTrasporto(targa: string): Observable<{ trasporto: UltimoTrasportoAutomezzo | null }> {
    return this.http.get<{ trasporto: UltimoTrasportoAutomezzo | null }>(
      `${this.API_URL}/ultimo-trasporto`,
      { params: { targa } }
    )
  }

  /**
   * «Firma la partenza su RENTRI»: l'operazione la sceglie l'ente (`/azioni`), la richiesta di firma e' una sola
   * (una sessione aperta viene ripresa). Con `nuovaSessione` (solo dopo scadenza o rifiuto) se ne chiede una nuova.
   */
  firmaPartenza(
    firId: string,
    payload: { nuovaSessione?: boolean } = {}
  ): Observable<EsitoFirmaPartenza> {
    return this.http.post<EsitoFirmaPartenza>(`${this.API_URL}/${firId}/firma-partenza`, payload)
  }

  /**
   * «Aggiungi un'annotazione» (FIR in viaggio, P4): il testo si firma subito con la firma remota. Il codice
   * fiscale del soggetto e' sempre quello dell'azienda selezionata (lo mette il backend).
   */
  aggiungiAnnotazione(firId: string, testo: string): Observable<EsitoAnnotazione> {
    return this.http.post<EsitoAnnotazione>(`${this.API_URL}/${firId}/annotazione`, { testo })
  }

  /** «Firma l'annotazione»: ripresa della firma di un'annotazione gia' registrata presso l'ente. */
  firmaAnnotazione(
    firId: string,
    payload: { nuovaSessione?: boolean } = {}
  ): Observable<EsitoFirmaRemota> {
    return this.http.post<EsitoFirmaRemota>(`${this.API_URL}/${firId}/firma-annotazione`, payload)
  }

  /**
   * «Dichiara una sosta tecnica» (FIR in viaggio, P5): luogo e istanti in UTC, firmati subito con la firma
   * remota del trasportatore. Il soggetto e' sempre l'azienda selezionata (lo mette il backend).
   */
  dichiaraSostaTecnica(firId: string, dati: DatiSostaTecnica): Observable<EsitoSostaTecnica> {
    return this.http.post<EsitoSostaTecnica>(`${this.API_URL}/${firId}/sosta-tecnica`, dati)
  }

  /** «Firma la sosta tecnica»: ripresa della firma di una sosta gia' registrata presso l'ente. */
  firmaSostaTecnica(
    firId: string,
    payload: { nuovaSessione?: boolean } = {}
  ): Observable<EsitoFirmaRemota> {
    return this.http.post<EsitoFirmaRemota>(`${this.API_URL}/${firId}/firma-sosta-tecnica`, payload)
  }

  /**
   * «Trasbordo totale» (FIR in viaggio, P6): passa il rifiuto a un nuovo trasportatore dell'anagrafica con i
   * suoi dati di trasporto. Il soggetto che invia e' sempre l'azienda selezionata (lo mette il backend).
   */
  dichiaraTrasbordoTotale(
    firId: string,
    dati: DatiTrasbordoTotale
  ): Observable<EsitoTrasbordoTotale> {
    return this.http.post<EsitoTrasbordoTotale>(`${this.API_URL}/${firId}/trasbordo-totale`, dati)
  }

  /** «Firma il trasbordo totale»: solo il NUOVO trasportatore (lo verifica il backend prima della richiesta). */
  firmaTrasbordoTotale(
    firId: string,
    payload: { nuovaSessione?: boolean } = {}
  ): Observable<EsitoFirmaRemota> {
    return this.http.post<EsitoFirmaRemota>(
      `${this.API_URL}/${firId}/firma-trasbordo-totale`,
      payload
    )
  }

  /** Sessione di firma in attesa (banner): sola lettura, nessuna chiamata all'ente. */
  firmaInAttesa(firId: string): Observable<{ sessione: SessioneFirmaInAttesa | null }> {
    return this.http.get<{ sessione: SessioneFirmaInAttesa | null }>(
      `${this.API_URL}/${firId}/firme/in-attesa`
    )
  }

  /**
   * «Ho confermato, controlla»: riprende il polling della stessa richiesta di firma. Con
   * `nuovaSessione` (solo dopo scadenza o rifiuto) chiede esplicitamente una nuova richiesta.
   */
  riprendiFirma(
    firId: string,
    sessioneId: string,
    payload: { nuovaSessione?: boolean } = {}
  ): Observable<EsitoFirmaRemota> {
    return this.http.post<EsitoFirmaRemota>(
      `${this.API_URL}/${firId}/firme/${sessioneId}/riprendi`,
      payload
    )
  }

  /** «Annulla la richiesta»: cancella i dati non ancora firmati e chiude la sessione in attesa. */
  resetStato(firId: string): Observable<EsitoRollbackOReset> {
    return this.http.post<EsitoRollbackOReset>(`${this.API_URL}/${firId}/reset`, {})
  }

  /** Annulla l'ultima firma apposta (solo se l'ente lo consente: `/azioni`). */
  rollbackFirma(firId: string): Observable<EsitoRollbackOReset> {
    return this.http.post<EsitoRollbackOReset>(`${this.API_URL}/${firId}/rollback-firma`, {})
  }

  /** Elenco locale (mai una chiamata a RENTRI, v. backend). */
  elencaAllegati(firId: string): Observable<AllegatoFirRentri[]> {
    return this.http.get<AllegatoFirRentri[]>(`${this.API_URL}/${firId}/allegati`)
  }

  caricaAllegato(
    firId: string,
    payload: CaricaAllegatoFirRentriPayload
  ): Observable<AllegatoFirRentri> {
    return this.http.post<AllegatoFirRentri>(`${this.API_URL}/${firId}/allegati`, payload)
  }

  eliminaAllegato(firId: string, allegatoId: string): Observable<{ eliminato: true }> {
    return this.http.delete<{ eliminato: true }>(`${this.API_URL}/${firId}/allegati/${allegatoId}`)
  }

  /**
   * Scarica il PDF del formulario (R3 Task 7): il backend fa da TRAMITE
   * (scarica da RENTRI e trasmette lo stream), mai un redirect al portale —
   * per questo la risposta è `blob`, non un URL da aprire in una nuova
   * scheda. `observe: 'response'` per leggere `Content-Disposition` (nome
   * file suggerito dall'ente) invece di indovinarlo lato client.
   */
  scaricaPdf(firId: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.API_URL}/${firId}/pdf`, {
      responseType: 'blob',
      observe: 'response',
    })
  }
}
