import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable, map } from 'rxjs'
import { environment } from '../../../environments/environment'
import { Pagina } from '../clienti/clienti.model'
import { RottaAllegati } from '../clienti/clienti.service'
import { Tabella } from '../clienti/tabelle-fatturazione.service'
import {
  Addebito,
  AnteprimaVariazione,
  AnteprimaVariazioneContratti,
  CodiceIva,
  CodificaAddebito,
  CodificaRentri,
  CorpoIstat,
  CorpoVariazione,
  CorpoVariazioneContratti,
  DatiAddebito,
  DatiRiga,
  ElencoAddebiti,
  ElenchiContratto,
  EsitoCopia,
  EsitoEliminazioneRiga,
  RigaSalvata,
  EsitoImpostazione,
  EsitoVariazione,
  FiltroAddebiti,
  GenereCodificaAddebito,
  MeseIstat,
  ModificaAddebito,
  ModificaCodiceIva,
  ModificaCodificaAddebito,
  ModificaElenco,
  ModificaRiga,
  NuovaCodificaAddebito,
  NuovoCodiceIva,
  NuovoElenco,
  PropostaRiga,
  RigaAddebito,
  TabellaCodificheRentri,
  TipoProvvigione,
} from './listino.model'

/** Codifiche di addebito: come `TabellaCodifiche` della 4.1, con i cinque generi del listino. */
export class TabellaCodificheAddebito {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  list(genere: GenereCodificaAddebito, incluseDisattivate = false): Observable<CodificaAddebito[]> {
    let params = new HttpParams().set('genere', genere)
    if (incluseDisattivate) params = params.set('incluseDisattivate', 'true')
    return this.http.get<CodificaAddebito[]>(this.url, { params })
  }

  /** Informativo: non riserva nulla. */
  prossimoCodice(genere: GenereCodificaAddebito): Observable<string> {
    return this.http
      .get<{ codice: string }>(`${this.url}/prossimo-codice`, {
        params: new HttpParams().set('genere', genere),
      })
      .pipe(map(r => r.codice))
  }

  get(id: string): Observable<CodificaAddebito> {
    return this.http.get<CodificaAddebito>(`${this.url}/${id}`)
  }

  crea(dati: NuovaCodificaAddebito): Observable<CodificaAddebito> {
    return this.http.post<CodificaAddebito>(this.url, dati)
  }

  modifica(id: string, dati: ModificaCodificaAddebito): Observable<CodificaAddebito> {
    return this.http.patch<CodificaAddebito>(`${this.url}/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}

/** Archivio degli addebiti: elenco paginato `{ elementi, totale }` (R12). */
export class TabellaAddebiti {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  list(filtro: FiltroAddebiti = {}): Observable<Pagina<Addebito>> {
    let params = new HttpParams()
    for (const [chiave, valore] of Object.entries(filtro)) {
      if (valore !== undefined && valore !== null && valore !== '') {
        params = params.set(chiave, String(valore))
      }
    }
    return this.http.get<Pagina<Addebito>>(this.url, { params })
  }

  /** Informativo: primo codice a cinque cifre libero. */
  prossimoCodice(): Observable<string> {
    return this.http.get<{ codice: string }>(`${this.url}/prossimo-codice`).pipe(map(r => r.codice))
  }

  get(id: string): Observable<Addebito> {
    return this.http.get<Addebito>(`${this.url}/${id}`)
  }

  crea(dati: DatiAddebito): Observable<Addebito> {
    return this.http.post<Addebito>(this.url, dati)
  }

  modifica(id: string, dati: ModificaAddebito): Observable<Addebito> {
    return this.http.patch<Addebito>(`${this.url}/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }

  anteprimaVariazione(corpo: CorpoVariazione): Observable<AnteprimaVariazione> {
    return this.http.post<AnteprimaVariazione>(`${this.url}/variazioni-prezzi/anteprima`, corpo)
  }

  /** Applica con l'impronta dell'anteprima (R24): risponde col numero dei prezzi aggiornati. */
  applicaVariazione(corpo: CorpoVariazione & { impronta: string }): Observable<EsitoVariazione> {
    return this.http.post<EsitoVariazione>(`${this.url}/variazioni-prezzi`, corpo)
  }
}

// === 4.2b ====================================================================================

/** Elenchi di un contratto (rotte annidate) e dell'elenco singolo (`/elenchi-addebiti`), Task 20. */
export class RotteElenchi {
  constructor(
    private readonly http: HttpClient,
    private readonly base: string
  ) {}

  /** Intestazione (contesto) ed elenchi del contratto. */
  delContratto(contrattoId: string): Observable<ElenchiContratto> {
    return this.http.get<ElenchiContratto>(`${this.base}/contratti-clienti/${contrattoId}/elenchi`)
  }

  /** Informativo: non riserva nulla. */
  prossimoCodice(contrattoId: string): Observable<string> {
    return this.http
      .get<{
        codice: string
      }>(`${this.base}/contratti-clienti/${contrattoId}/elenchi/prossimo-codice`)
      .pipe(map(r => r.codice))
  }

  crea(contrattoId: string, dati: NuovoElenco): Observable<ElencoAddebiti> {
    return this.http.post<ElencoAddebiti>(
      `${this.base}/contratti-clienti/${contrattoId}/elenchi`,
      dati
    )
  }

  modifica(id: string, dati: ModificaElenco): Observable<ElencoAddebiti> {
    return this.http.patch<ElencoAddebiti>(`${this.base}/elenchi-addebiti/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/elenchi-addebiti/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}

/** Righe di un elenco (`GET|POST /elenchi-addebiti/:id/righe`) e riga singola, Task 21. */
export class RotteRighe {
  constructor(
    private readonly http: HttpClient,
    private readonly base: string
  ) {}

  list(elencoId: string): Observable<RigaAddebito[]> {
    return this.http.get<RigaAddebito[]>(`${this.base}/elenchi-addebiti/${elencoId}/righe`)
  }

  crea(elencoId: string, dati: DatiRiga): Observable<RigaAddebito> {
    return this.http.post<RigaAddebito>(`${this.base}/elenchi-addebiti/${elencoId}/righe`, dati)
  }

  modifica(id: string, dati: ModificaRiga): Observable<RigaSalvata> {
    return this.http.patch<RigaSalvata>(`${this.base}/righe-addebito/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<EsitoEliminazioneRiga> {
    return this.http.delete<EsitoEliminazioneRiga>(`${this.base}/righe-addebito/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }

  /** Valori proposti alla scelta del CER o dell'addebito (D6, D7). */
  proposta(
    contrattoId: string,
    scelta: { addebitoId?: string; cerCode?: string }
  ): Observable<PropostaRiga> {
    let params = new HttpParams()
    if (scelta.addebitoId) params = params.set('addebitoId', scelta.addebitoId)
    if (scelta.cerCode) params = params.set('cerCode', scelta.cerCode)
    return this.http.get<PropostaRiga>(
      `${this.base}/contratti-clienti/${contrattoId}/righe-proposta`,
      { params }
    )
  }

  /** Stati fisici e operazioni dalle codifiche RENTRI (R42). */
  codificheRentri(tabella: TabellaCodificheRentri): Observable<CodificaRentri[]> {
    return this.http.get<CodificaRentri[]>(`${this.base}/righe-addebito/codifiche-rentri`, {
      params: new HttpParams().set('tabella', tabella),
    })
  }
}

/** Copia di righe e impostazioni su tutto il contratto (D18, D19, R45), Task 23. */
export class RotteAzioniListino {
  constructor(
    private readonly http: HttpClient,
    private readonly base: string
  ) {}

  sostituisciDa(elencoId: string, daElencoId: string, versione: number): Observable<EsitoCopia> {
    return this.http.post<EsitoCopia>(`${this.base}/elenchi-addebiti/${elencoId}/sostituisci-da`, {
      daElencoId,
      versione,
    })
  }

  aggiungiRighe(elencoId: string, righeIds: string[], versione: number): Observable<EsitoCopia> {
    return this.http.post<EsitoCopia>(`${this.base}/elenchi-addebiti/${elencoId}/aggiungi-righe`, {
      righeIds,
      versione,
    })
  }

  /** `provvigione` vuota o null svuota provvigione e tipo (R45). */
  provvigioni(
    contrattoId: string,
    dati: { provvigione: string | null; tipoProvvigione: TipoProvvigione | null }
  ): Observable<EsitoImpostazione> {
    return this.http.post<EsitoImpostazione>(
      `${this.base}/contratti-clienti/${contrattoId}/provvigioni`,
      dati
    )
  }

  sconti(
    contrattoId: string,
    dati: { scontoAttuale: string; scontoNuovo: string }
  ): Observable<EsitoImpostazione> {
    return this.http.post<EsitoImpostazione>(
      `${this.base}/contratti-clienti/${contrattoId}/sconti`,
      dati
    )
  }
}

/** Variazione di massa dei prezzi dei contratti e adeguamento ISTAT (D20, D22, R46), Task 24. */
export class RotteVariazioniContratti {
  private readonly url: string

  constructor(
    private readonly http: HttpClient,
    base: string
  ) {
    this.url = `${base}/variazioni-prezzi`
  }

  anteprima(corpo: CorpoVariazioneContratti): Observable<AnteprimaVariazioneContratti> {
    return this.http.post<AnteprimaVariazioneContratti>(`${this.url}/anteprima`, corpo)
  }

  applica(corpo: CorpoVariazioneContratti & { impronta: string }): Observable<EsitoVariazione> {
    return this.http.post<EsitoVariazione>(this.url, corpo)
  }

  mesiIstat(ancheAnnoPrecedente = false): Observable<MeseIstat[]> {
    let params = new HttpParams()
    if (ancheAnnoPrecedente) params = params.set('ancheAnnoPrecedente', 'true')
    return this.http.get<MeseIstat[]>(`${this.url}/istat/mesi`, { params })
  }

  anteprimaIstat(corpo: CorpoIstat): Observable<AnteprimaVariazioneContratti> {
    return this.http.post<AnteprimaVariazioneContratti>(`${this.url}/istat/anteprima`, corpo)
  }

  applicaIstat(corpo: CorpoIstat & { impronta: string }): Observable<EsitoVariazione> {
    return this.http.post<EsitoVariazione>(`${this.url}/istat`, corpo)
  }
}

@Injectable({ providedIn: 'root' })
export class ListinoService {
  private readonly base = environment.apiUrl

  readonly codiciIva: Tabella<CodiceIva, CodiceIva, NuovoCodiceIva, ModificaCodiceIva>
  readonly codifiche: TabellaCodificheAddebito
  readonly addebiti: TabellaAddebiti
  readonly elenchi: RotteElenchi
  readonly righe: RotteRighe
  readonly azioni: RotteAzioniListino
  readonly variazioniContratti: RotteVariazioniContratti
  /** PDF dell'elenco: stessa forma di quelli del contratto (4.1b), Task 25. */
  readonly allegatiElenco: RottaAllegati

  constructor() {
    const http = inject(HttpClient)
    this.codiciIva = new Tabella(http, `${this.base}/codici-iva`)
    this.codifiche = new TabellaCodificheAddebito(http, `${this.base}/codifiche-addebito`)
    this.addebiti = new TabellaAddebiti(http, `${this.base}/addebiti`)
    this.elenchi = new RotteElenchi(http, this.base)
    this.righe = new RotteRighe(http, this.base)
    this.azioni = new RotteAzioniListino(http, this.base)
    this.variazioniContratti = new RotteVariazioniContratti(http, this.base)
    this.allegatiElenco = new RottaAllegati(http, `${this.base}/elenchi-addebiti`)
  }
}
