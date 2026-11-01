import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable, map } from 'rxjs'
import { environment } from '../../../environments/environment'
import {
  Agente,
  AllegatoContratto,
  CambioStatoContratto,
  Cliente,
  ContrattoCliente,
  EsitoAgente,
  EsitoCliente,
  FiltroContratti,
  FiltroRuolo,
  ModificaAgente,
  ModificaCliente,
  ModificaContrattoCliente,
  NuovoAgente,
  NuovoCliente,
  NuovoContrattoCliente,
  Pagina,
  ProrogaScadenze,
} from './clienti.model'

/** Solo i parametri valorizzati: un filtro assente non viaggia. */
function parametri(filtro?: object): HttpParams {
  let params = new HttpParams()
  for (const [chiave, valore] of Object.entries(filtro ?? {})) {
    if (valore !== undefined && valore !== null && valore !== '') {
      params = params.set(chiave, String(valore))
    }
  }
  return params
}

/** CRUD di un ruolo sulla ditta (agenti, clienti): elenco paginato, versione su modifica ed elimina. */
class RuoloDitta<Vista, Nuovo, Modifica, Esito> {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  list(filtro?: FiltroRuolo): Observable<Pagina<Vista>> {
    return this.http.get<Pagina<Vista>>(this.url, { params: parametri(filtro) })
  }

  get(id: string): Observable<Vista> {
    return this.http.get<Vista>(`${this.url}/${id}`)
  }

  /** La risposta porta anche `dittaEsistente` e `avvisi`. */
  crea(dati: Nuovo): Observable<Esito> {
    return this.http.post<Esito>(this.url, dati)
  }

  modifica(id: string, dati: Modifica): Observable<Vista> {
    return this.http.patch<Vista>(`${this.url}/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}

export class RottaContratti {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  list(filtro?: FiltroContratti): Observable<Pagina<ContrattoCliente>> {
    return this.http.get<Pagina<ContrattoCliente>>(this.url, { params: parametri(filtro) })
  }

  /** Informativo: `CC-<anno>-<NNN>`, non riserva nulla. */
  prossimoNumero(): Observable<string> {
    return this.http.get<{ numero: string }>(`${this.url}/prossimo-numero`).pipe(map(r => r.numero))
  }

  get(id: string): Observable<ContrattoCliente> {
    return this.http.get<ContrattoCliente>(`${this.url}/${id}`)
  }

  crea(dati: NuovoContrattoCliente): Observable<ContrattoCliente> {
    return this.http.post<ContrattoCliente>(this.url, dati)
  }

  modifica(id: string, dati: ModificaContrattoCliente): Observable<ContrattoCliente> {
    return this.http.patch<ContrattoCliente>(`${this.url}/${id}`, dati)
  }

  cambiaStato(id: string, cambio: CambioStatoContratto): Observable<ContrattoCliente> {
    return this.http.patch<ContrattoCliente>(`${this.url}/${id}/stato`, cambio)
  }

  /** Sposta la data di fine di un anno. */
  rinnova(id: string, versione: number): Observable<ContrattoCliente> {
    return this.http.post<ContrattoCliente>(`${this.url}/${id}/rinnova`, { versione })
  }

  /** Proroga massiva delle scadenze. */
  proroga(dati: ProrogaScadenze): Observable<{ prorogati: number }> {
    return this.http.post<{ prorogati: number }>(`${this.url}/proroga-scadenze`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}

export class RottaAllegati {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  private base(contrattoId: string): string {
    return `${this.url}/${contrattoId}/allegati`
  }

  elenco(contrattoId: string): Observable<AllegatoContratto[]> {
    return this.http.get<AllegatoContratto[]>(this.base(contrattoId))
  }

  /** PDF fino a 4 MB, in posizione 1 o 2. */
  carica(contrattoId: string, posizione: 1 | 2, file: File): Observable<AllegatoContratto> {
    const corpo = new FormData()
    corpo.append('allegato', file)
    corpo.append('posizione', String(posizione))
    return this.http.post<AllegatoContratto>(this.base(contrattoId), corpo)
  }

  scarica(contrattoId: string, allegatoId: string): Observable<Blob> {
    return this.http.get(`${this.base(contrattoId)}/${allegatoId}/contenuto`, {
      responseType: 'blob',
    })
  }

  rimuovi(contrattoId: string, allegatoId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(contrattoId)}/${allegatoId}`)
  }
}

@Injectable({ providedIn: 'root' })
export class ClientiService {
  private readonly base = environment.apiUrl

  readonly agenti: RuoloDitta<Agente, NuovoAgente, ModificaAgente, EsitoAgente>
  readonly clienti: RuoloDitta<Cliente, NuovoCliente, ModificaCliente, EsitoCliente>
  readonly contratti: RottaContratti
  readonly allegati: RottaAllegati

  constructor(http: HttpClient) {
    this.agenti = new RuoloDitta(http, `${this.base}/agenti`)
    this.clienti = new RuoloDitta(http, `${this.base}/clienti`)
    this.contratti = new RottaContratti(http, `${this.base}/contratti-clienti`)
    this.allegati = new RottaAllegati(http, `${this.base}/contratti-clienti`)
  }
}
