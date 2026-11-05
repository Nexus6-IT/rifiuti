import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'
import {
  DocumentoDettaglio,
  DocumentoRiga,
  ElaborazioneDettaglio,
  ElaborazioneRiga,
  NuovaElaborazione,
  Pagina,
  ScostamentoRiga,
  SelezioneExport,
  StatoDocumento,
  StatoElaborazione,
} from './fatturazione.model'

export const DIMENSIONE_PREDEFINITA = 50
export const DIMENSIONE_MASSIMA = 100

export interface ParametriPagina {
  pagina?: number
  /** Predefinita 50; oltre 100 il servizio manda 100 (il backend risponde 400 sopra il tetto). */
  dimensione?: number
}

export interface ParametriElaborazioni extends ParametriPagina {
  stato?: StatoElaborazione
}

/** Date `AAAA-MM-GG`. */
export interface ParametriDocumenti extends ParametriPagina {
  registroIvaId?: string
  anno?: number
  stato?: StatoDocumento
  clienteId?: string
  dataDa?: string
  dataA?: string
}

export interface ParametriScostamenti extends ParametriPagina {
  contrattoId?: string
}

/**
 * Servizio HTTP della fatturazione per periodo (4.4b), una funzione per rotta del §11 della spec
 * (mappature e credenziali sono della 4.4c/d). Separato da `ImpostazioniFatturazione44Service`.
 * `confermaEmissione` è sempre un parametro esplicito: il servizio non lo mette mai a `true`
 * da solo (Q28).
 */
@Injectable({ providedIn: 'root' })
export class FatturazioneService {
  private readonly http = inject(HttpClient)
  private readonly urlElaborazioni = `${environment.apiUrl}/elaborazioni-fatturazione`
  private readonly urlDocumenti = `${environment.apiUrl}/documenti-fattura`
  private readonly urlScostamenti = `${environment.apiUrl}/scostamenti-fattura`
  private readonly urlLegami = `${environment.apiUrl}/legami-movimento`

  private elaborazione(id: string): string {
    return `${this.urlElaborazioni}/${encodeURIComponent(id)}`
  }
  private urlDocumento(id: string): string {
    return `${this.urlDocumenti}/${encodeURIComponent(id)}`
  }

  // --- Elaborazioni -------------------------------------------------------------------------

  /** Avvia l'anteprima (202): l'elaborazione nasce `IN_CODA`. */
  avvia(dati: NuovaElaborazione): Observable<ElaborazioneRiga> {
    return this.http.post<ElaborazioneRiga>(this.urlElaborazioni, dati)
  }

  lista(opzioni: ParametriElaborazioni = {}): Observable<Pagina<ElaborazioneRiga>> {
    return this.http.get<Pagina<ElaborazioneRiga>>(this.urlElaborazioni, {
      params: parametri({ stato: opzioni.stato }, opzioni),
    })
  }

  dettaglio(id: string): Observable<ElaborazioneDettaglio> {
    return this.http.get<ElaborazioneDettaglio>(this.elaborazione(id))
  }

  /** Documenti (bozze) dell'elaborazione, paginati. */
  documentiElaborazione(
    id: string,
    opzioni: ParametriPagina = {}
  ): Observable<Pagina<DocumentoRiga>> {
    return this.http.get<Pagina<DocumentoRiga>>(`${this.elaborazione(id)}/documenti`, {
      params: parametri({}, opzioni),
    })
  }

  ricalcola(id: string): Observable<ElaborazioneRiga> {
    return this.http.post<ElaborazioneRiga>(`${this.elaborazione(id)}/ricalcola`, {})
  }

  scarta(id: string): Observable<ElaborazioneRiga> {
    return this.http.post<ElaborazioneRiga>(`${this.elaborazione(id)}/scarta`, {})
  }

  escludi(id: string, documentoId: string): Observable<DocumentoRiga> {
    return this.http.post<DocumentoRiga>(
      `${this.elaborazione(id)}/documenti/${encodeURIComponent(documentoId)}/escludi`,
      {}
    )
  }

  riammetti(id: string, documentoId: string): Observable<DocumentoRiga> {
    return this.http.post<DocumentoRiga>(
      `${this.elaborazione(id)}/documenti/${encodeURIComponent(documentoId)}/riammetti`,
      {}
    )
  }

  /** Definitiva (202): `impronta` e `versione` sono quelle dell'anteprima che l'utente ha visto. */
  definitiva(id: string, impronta: string, versione: number): Observable<ElaborazioneRiga> {
    return this.http.post<ElaborazioneRiga>(`${this.elaborazione(id)}/definitiva`, {
      impronta,
      versione,
    })
  }

  // --- Documenti ----------------------------------------------------------------------------

  documenti(opzioni: ParametriDocumenti = {}): Observable<Pagina<DocumentoRiga>> {
    return this.http.get<Pagina<DocumentoRiga>>(this.urlDocumenti, {
      params: parametri(
        {
          registroIvaId: opzioni.registroIvaId,
          anno: opzioni.anno,
          stato: opzioni.stato,
          clienteId: opzioni.clienteId,
          dataDa: opzioni.dataDa,
          dataA: opzioni.dataA,
        },
        opzioni
      ),
    })
  }

  documento(id: string): Observable<DocumentoDettaglio> {
    return this.http.get<DocumentoDettaglio>(this.urlDocumento(id))
  }

  annulla(id: string, motivo: string, versione: number): Observable<DocumentoDettaglio> {
    return this.http.post<DocumentoDettaglio>(`${this.urlDocumento(id)}/annulla`, {
      motivo,
      versione,
    })
  }

  /** Nota di credito di storno. `dataDocumento` è `AAAA-MM-GG`. */
  storno(
    id: string,
    dati: { motivo: string; dataDocumento: string; rifatturabile: boolean }
  ): Observable<DocumentoDettaglio> {
    return this.http.post<DocumentoDettaglio>(`${this.urlDocumento(id)}/storno`, dati)
  }

  segnaEmesso(id: string): Observable<DocumentoDettaglio> {
    return this.http.post<DocumentoDettaglio>(`${this.urlDocumento(id)}/emesso`, {})
  }

  /** Scarica l'XML. Con `confermaEmissione: true` un documento non emesso diventa «emesso». */
  scaricaXml(id: string, confermaEmissione: boolean): Observable<Blob> {
    return this.http.post(
      `${this.urlDocumento(id)}/xml`,
      { confermaEmissione },
      { responseType: 'blob' }
    )
  }

  /** Copia di cortesia: non cambia lo stato. */
  pdf(id: string): Observable<Blob> {
    return this.http.get(`${this.urlDocumento(id)}/pdf`, { responseType: 'blob' })
  }

  /**
   * `formato`: `CSV`, `XML_ZIP` o il codice di un adattatore. `XML_ZIP` e adattatori rendono i
   * documenti «emessi» e richiedono `confermaEmissione: true`; `CSV` no.
   */
  esporta(
    formato: string,
    selezione: SelezioneExport,
    confermaEmissione: boolean
  ): Observable<Blob> {
    return this.http.post(
      `${this.urlDocumenti}/export`,
      { formato, selezione, confermaEmissione },
      { responseType: 'blob' }
    )
  }

  // --- Scostamenti --------------------------------------------------------------------------

  scostamenti(opzioni: ParametriScostamenti = {}): Observable<Pagina<ScostamentoRiga>> {
    return this.http.get<Pagina<ScostamentoRiga>>(this.urlScostamenti, {
      params: parametri({ contrattoId: opzioni.contrattoId }, opzioni),
    })
  }

  presaAtto(legameId: string, nota: string): Observable<void> {
    return this.http.post<void>(
      `${this.urlLegami}/${encodeURIComponent(legameId)}/presa-atto-scostamento`,
      { nota }
    )
  }
}

/** Parametri di query: omette i valori assenti e porta `dimensione` a 1..100 (predefinita 50). */
function parametri(
  filtri: Record<string, string | number | undefined>,
  pagina: ParametriPagina
): HttpParams {
  let p = new HttpParams()
  for (const [chiave, valore] of Object.entries(filtri)) {
    if (valore !== undefined && valore !== '') p = p.set(chiave, String(valore))
  }
  const dimensione = Math.min(
    DIMENSIONE_MASSIMA,
    Math.max(1, Math.floor(pagina.dimensione ?? DIMENSIONE_PREDEFINITA))
  )
  return p
    .set('pagina', String(Math.max(1, Math.floor(pagina.pagina ?? 1))))
    .set('dimensione', String(dimensione))
}
