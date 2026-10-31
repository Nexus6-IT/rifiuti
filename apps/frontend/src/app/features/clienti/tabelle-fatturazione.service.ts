import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable, map } from 'rxjs'
import { environment } from '../../../environments/environment'
import {
  CodificaContratto,
  CondizionePagamento,
  ContoCorrente,
  ContoCorrenteInElenco,
  DatiCondizionePagamento,
  DatiRegistroIva,
  DatiSpesaAccessoria,
  DatiTestoFatturazione,
  GenereCodifica,
  ModificaCodifica,
  ModificaCondizione,
  ModificaContoCorrente,
  ModificaRegistroIva,
  ModificaSpesa,
  ModificaTestoFatturazione,
  NuovaCodifica,
  NuovoContoCorrente,
  RegistroIva,
  SpesaAccessoria,
  TestoFatturazione,
  TipoSpesa,
} from './clienti.model'

export interface FiltroTabella {
  incluseDisattivate?: boolean
}

export interface FiltroSpese extends FiltroTabella {
  tipo?: TipoSpesa
}

/** CRUD comune alle tabelle versionate (cancellazione e modifica con `versione`). */
class Tabella<Elenco, Dettaglio, Nuovo, Modifica, Filtro extends FiltroTabella = FiltroTabella> {
  constructor(
    protected readonly http: HttpClient,
    protected readonly url: string
  ) {}

  protected parametri(filtro?: Filtro): HttpParams {
    let params = new HttpParams()
    if (filtro?.incluseDisattivate) params = params.set('incluseDisattivate', 'true')
    return params
  }

  list(filtro?: Filtro): Observable<Elenco[]> {
    return this.http.get<Elenco[]>(this.url, { params: this.parametri(filtro) })
  }

  get(id: string): Observable<Dettaglio> {
    return this.http.get<Dettaglio>(`${this.url}/${id}`)
  }

  crea(dati: Nuovo): Observable<Dettaglio> {
    return this.http.post<Dettaglio>(this.url, dati)
  }

  modifica(id: string, dati: Modifica): Observable<Dettaglio> {
    return this.http.patch<Dettaglio>(`${this.url}/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}

class TabellaSpese extends Tabella<
  SpesaAccessoria,
  SpesaAccessoria,
  DatiSpesaAccessoria,
  ModificaSpesa,
  FiltroSpese
> {
  protected override parametri(filtro?: FiltroSpese): HttpParams {
    const params = super.parametri(filtro)
    return filtro?.tipo ? params.set('tipo', filtro.tipo) : params
  }
}

class TabellaCodifiche {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  list(genere: GenereCodifica, incluseDisattivate = false): Observable<CodificaContratto[]> {
    let params = new HttpParams().set('genere', genere)
    if (incluseDisattivate) params = params.set('incluseDisattivate', 'true')
    return this.http.get<CodificaContratto[]>(this.url, { params })
  }

  /** Informativo: non riserva nulla. */
  prossimoCodice(genere: GenereCodifica): Observable<string> {
    return this.http
      .get<{ codice: string }>(`${this.url}/prossimo-codice`, {
        params: new HttpParams().set('genere', genere),
      })
      .pipe(map(r => r.codice))
  }

  get(id: string): Observable<CodificaContratto> {
    return this.http.get<CodificaContratto>(`${this.url}/${id}`)
  }

  crea(dati: NuovaCodifica): Observable<CodificaContratto> {
    return this.http.post<CodificaContratto>(this.url, dati)
  }

  modifica(id: string, dati: ModificaCodifica): Observable<CodificaContratto> {
    return this.http.patch<CodificaContratto>(`${this.url}/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}

@Injectable({ providedIn: 'root' })
export class TabelleFatturazioneService {
  private readonly base = environment.apiUrl

  readonly condizioni: Tabella<
    CondizionePagamento,
    CondizionePagamento,
    DatiCondizionePagamento,
    ModificaCondizione
  >
  /** L'elenco ha l'IBAN mascherato; il dettaglio (`get`) quello intero. */
  readonly conti: Tabella<
    ContoCorrenteInElenco,
    ContoCorrente,
    NuovoContoCorrente,
    ModificaContoCorrente
  >
  readonly spese: TabellaSpese
  readonly registri: Tabella<RegistroIva, RegistroIva, DatiRegistroIva, ModificaRegistroIva>
  readonly testi: Tabella<
    TestoFatturazione,
    TestoFatturazione,
    DatiTestoFatturazione,
    ModificaTestoFatturazione
  >
  readonly codifiche: TabellaCodifiche

  constructor(http: HttpClient) {
    this.condizioni = new Tabella(http, `${this.base}/condizioni-pagamento`)
    this.conti = new Tabella(http, `${this.base}/conti-correnti`)
    this.spese = new TabellaSpese(http, `${this.base}/spese-accessorie`)
    this.registri = new Tabella(http, `${this.base}/registri-iva`)
    this.testi = new Tabella(http, `${this.base}/testi-fatturazione`)
    this.codifiche = new TabellaCodifiche(http, `${this.base}/codifiche-contratto`)
  }
}
