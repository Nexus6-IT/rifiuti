import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, map } from 'rxjs'
import { environment } from '../../../environments/environment'
import {
  AdattatoreVista,
  DocumentoDettaglio,
  DocumentoRiga,
  ElaborazioneDettaglio,
  ChiaveMancante,
  ElaborazioneRiga,
  MappaturaVista,
  NuovaElaborazione,
  Pagina,
  ScostamentoRiga,
  SelezioneExport,
  StatoDocumento,
  StatoElaborazione,
  VoceMappatura,
} from './fatturazione.model'

export const DIMENSIONE_PREDEFINITA = 50
export const DIMENSIONE_MASSIMA = 100

export interface ParametriPagina {
  pagina?: number
  /** Predefinita 50; oltre 100 il servizio manda 100 (il backend risponde 400 sopra il tetto). */
  dimensione?: number
}

export interface ParametriDocumentiElaborazione extends ParametriPagina {
  /** Solo i documenti con errori. */
  conErrori?: boolean
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
  elaborazioneId?: string
}

export interface ParametriScostamenti extends ParametriPagina {
  clienteId?: string
}

/** File scaricato: nome da `Content-Disposition`, `saltati` da `X-Documenti-Saltati` (XML_ZIP). */
export interface FileScaricato {
  blob: Blob
  nomeFile: string | null
  saltati: number
}

/** Nome da `attachment; filename="..."` (anche `filename*=UTF-8''...`); null se assente. */
export function nomeFileDa(disposition: string | null): string | null {
  if (!disposition) return null
  const esteso = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (esteso) {
    try {
      return decodeURIComponent(esteso[1].trim())
    } catch {
      /* ripiega sul nome semplice */
    }
  }
  const semplice = /filename="?([^";]+)"?/i.exec(disposition)
  return semplice ? semplice[1].trim() : null
}

function daRisposta(r: HttpResponse<Blob>): FileScaricato {
  const saltati = Number.parseInt(r.headers.get('X-Documenti-Saltati') ?? '', 10)
  return {
    blob: r.body ?? new Blob(),
    nomeFile: nomeFileDa(r.headers.get('Content-Disposition')),
    saltati: Number.isFinite(saltati) && saltati > 0 ? saltati : 0,
  }
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
  private readonly urlExportContabile = `${environment.apiUrl}/export-contabile`

  private elaborazione(id: string): string {
    return `${this.urlElaborazioni}/${encodeURIComponent(id)}`
  }
  private urlDocumento(id: string): string {
    return `${this.urlDocumenti}/${encodeURIComponent(id)}`
  }

  // --- Elaborazioni -------------------------------------------------------------------------

  /** Avvia l'anteprima (202): l'elaborazione nasce `IN_CODA`. */
  avvia(dati: NuovaElaborazione): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(this.urlElaborazioni, dati)
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
    opzioni: ParametriDocumentiElaborazione = {}
  ): Observable<Pagina<DocumentoRiga>> {
    return this.http.get<Pagina<DocumentoRiga>>(`${this.elaborazione(id)}/documenti`, {
      params: parametri({ conErrori: opzioni.conErrori }, opzioni),
    })
  }

  /** Accoda il ricalcolo (202). La UI rilegge `dettaglio(id)`. */
  ricalcola(id: string, versione: number): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.elaborazione(id)}/ricalcola`, { versione })
  }

  scarta(id: string, versione: number): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.elaborazione(id)}/scarta`, { versione })
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
  definitiva(id: string, impronta: string, versione: number): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.elaborazione(id)}/definitiva`, {
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
          elaborazioneId: opzioni.elaborazioneId,
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
    dati: { motivo: string; dataDocumento: string; rifatturabile: boolean; versione: number }
  ): Observable<DocumentoDettaglio> {
    return this.http.post<DocumentoDettaglio>(`${this.urlDocumento(id)}/storno`, dati)
  }

  segnaEmesso(id: string, versione: number): Observable<DocumentoDettaglio> {
    return this.http.post<DocumentoDettaglio>(`${this.urlDocumento(id)}/emesso`, { versione })
  }

  /** Scarica l'XML. Con `confermaEmissione: true` un documento non emesso diventa «emesso». */
  scaricaXml(id: string, confermaEmissione: boolean): Observable<FileScaricato> {
    return this.http
      .post(
        `${this.urlDocumento(id)}/xml`,
        { confermaEmissione },
        { responseType: 'blob', observe: 'response' }
      )
      .pipe(map(daRisposta))
  }

  /** Copia di cortesia come file (nome da `Content-Disposition`), stesso schema di `scaricaXml`. */
  scaricaPdf(id: string): Observable<FileScaricato> {
    return this.http
      .get(`${this.urlDocumento(id)}/pdf`, { responseType: 'blob', observe: 'response' })
      .pipe(map(daRisposta))
  }

  /**
   * `formato`: `CSV`, `XML_ZIP` o il codice di un adattatore. `XML_ZIP` e adattatori rendono i
   * documenti «emessi» e richiedono `confermaEmissione: true`; `CSV` no.
   */
  esporta(
    formato: string,
    selezione: SelezioneExport,
    confermaEmissione: boolean
  ): Observable<FileScaricato> {
    return this.http
      .post(
        `${this.urlDocumenti}/export`,
        { formato, selezione, confermaEmissione },
        { responseType: 'blob', observe: 'response' }
      )
      .pipe(map(daRisposta))
  }

  // --- Export contabile (solo ADMIN e SUPER_ADMIN) -------------------------------------------

  /** Gestionali disponibili; vuoto se nessun adattatore è registrato. */
  adattatori(): Observable<AdattatoreVista[]> {
    return this.http.get<AdattatoreVista[]>(`${this.urlExportContabile}/adattatori`)
  }

  mappature(adattatore: string): Observable<MappaturaVista[]> {
    return this.http.get<MappaturaVista[]>(
      `${this.urlExportContabile}/${encodeURIComponent(adattatore)}/mappature`
    )
  }

  /** Chiavi ancora da mappare per i documenti scelti (stessa selezione dell'export). */
  chiaviMancanti(adattatore: string, selezione: SelezioneExport): Observable<ChiaveMancante[]> {
    return this.http.post<ChiaveMancante[]>(
      `${this.urlExportContabile}/${encodeURIComponent(adattatore)}/mancanti`,
      selezione
    )
  }

  /** Scrive le voci in un solo `PUT` (`valore: null` cancella) e restituisce le mappature aggiornate. */
  salvaMappature(adattatore: string, voci: VoceMappatura[]): Observable<MappaturaVista[]> {
    return this.http.put<MappaturaVista[]>(
      `${this.urlExportContabile}/${encodeURIComponent(adattatore)}/mappature`,
      { voci }
    )
  }

  // --- Scostamenti --------------------------------------------------------------------------

  scostamenti(opzioni: ParametriScostamenti = {}): Observable<Pagina<ScostamentoRiga>> {
    return this.http.get<Pagina<ScostamentoRiga>>(this.urlScostamenti, {
      params: parametri({ clienteId: opzioni.clienteId }, opzioni),
    })
  }

  presaAtto(legameId: string, nota: string, versione: number): Observable<void> {
    return this.http.post<void>(
      `${this.urlLegami}/${encodeURIComponent(legameId)}/presa-atto-scostamento`,
      { nota, versione }
    )
  }
}

/** Parametri di query: omette i valori assenti e porta `dimensione` a 1..100 (predefinita 50). */
function parametri(
  filtri: Record<string, string | number | boolean | undefined>,
  pagina: ParametriPagina
): HttpParams {
  let p = new HttpParams()
  for (const [chiave, valore] of Object.entries(filtri)) {
    if (valore !== undefined && valore !== '') p = p.set(chiave, String(valore))
  }
  const intero = (x: number | undefined, predefinito: number): number =>
    x !== undefined && Number.isFinite(x) ? Math.floor(x) : predefinito
  const dimensione = Math.min(
    DIMENSIONE_MASSIMA,
    Math.max(1, intero(pagina.dimensione, DIMENSIONE_PREDEFINITA))
  )
  return p
    .set('pagina', String(Math.max(1, intero(pagina.pagina, 1))))
    .set('dimensione', String(dimensione))
}
