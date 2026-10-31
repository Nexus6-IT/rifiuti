import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

// Tipi delle viste del backend (D15 del piano 4.8a). I permessi non si deducono dal token:
// li dice il backend in ogni risposta di elenco e di dettaglio.

export type FontePesata = 'STRUMENTO' | 'FILE' | 'MANUALE' | 'TARA_ANAGRAFICA'
export type VersoPesata = 'CARICO' | 'SCARICO'
export type ModoPesatura = 'DOPPIA' | 'TARA_ANAGRAFICA' | 'SINGOLA'
export type StatoAccesso = 'APERTO' | 'CHIUSO' | 'ANNULLATO'
export type QualitaNetto = 'DUE_PESATE' | 'TARA_DICHIARATA' | 'PESATA_SINGOLA'

export interface Permessi {
  puoOperare: boolean
  puoRettificare: boolean
}

export interface ElencoConPermessi<T> extends Permessi {
  righe: T[]
}

export interface StrumentoPesa {
  id: string
  registroId: string | null
  descrizione: string
  costruttore: string | null
  modello: string | null
  matricola: string | null
  portataMaxKg: number | null
  divisioneKg: number | null
  /** AAAA-MM-GG */
  dataUltimaVerificazione: string | null
  attivo: boolean
}

export interface DatiStrumento {
  descrizione: string
  costruttore?: string | null
  modello?: string | null
  matricola?: string | null
  registroId?: string | null
  portataMaxKg?: number | null
  divisioneKg?: number | null
  dataUltimaVerificazione?: string | null
  attivo?: boolean
}

export interface Automezzo {
  id: string
  targa: string
  targaRimorchio: string | null
  trasportatoreId: string | null
  taraKg: number | null
  taraOrigine: 'DICHIARATA' | 'PESATA' | null
  taraPesataId: string | null
  taraAggiornataIl: string | null
  ultimaPesataVuotoIl: string | null
  note: string | null
  attivo: boolean
}

export interface DatiAutomezzo {
  targa: string
  targaRimorchio?: string | null
  trasportatoreId?: string | null
  note?: string | null
  attivo?: boolean
}

/** Esattamente uno dei due: tara dichiarata (solo amministratori) o da una pesata. */
export type RichiestaTara = { taraKg: number } | { pesataId: string }

export interface AllegatoVista {
  id: string
  nomeFile: string
  mimeType: string
  dimensioneByte: number
}

export interface RettificaVista {
  id: string
  numero: number
  pesoPrecedenteKg: number
  pesoNuovoKg: number
  motivo: string
  autore: string | null
  createdAt: string
  allegato: AllegatoVista | null
  integra: boolean
}

export interface PesataVista {
  id: string
  ordine: number
  fonte: FontePesata
  pesoOriginaleKg: number
  pesoEffettivoKg: number
  rettifiche: RettificaVista[]
  strumento: { id: string; descrizione: string; matricola: string | null } | null
  strumentoEsterno: string | null
  alibiId: string | null
  oraStrumento: string | null
  oraRicezione: string
  operatore: string | null
  motivo: string | null
  allegato: AllegatoVista | null
  integra: boolean
  avvisi: string[]
}

export interface EsitoNetto {
  stato: 'INCOMPLETO' | 'CALCOLATO' | 'NON_VALIDO'
  lordoKg: number | null
  taraKg: number | null
  nettoKg: number | null
  qualita: QualitaNetto | null
  manuale: boolean
  rettificato: boolean
  errore: string | null
  avvisi: string[]
}

export interface ConfrontoDocumento {
  confrontabile: boolean
  quantitaKg: number | null
  differenzaKg: number | null
}

export interface CollegamentoVista {
  id: string
  tipo: 'FIR' | 'MOVIMENTO'
  fir?: {
    id: string
    numero: string
    stato: string
    quantita: number
    unita: string
    pesoEffettivo: number | null
  }
  movimento?: {
    id: string
    numero: string
    numeroVigente: string | null
    quantita: number | null
    unita: string | null
    annullato: boolean
  }
  confronto: ConfrontoDocumento | null
  creatoIl: string
  revocatoIl: string | null
  motivoRevoca: string | null
}

export interface AccessoVista extends Permessi {
  id: string
  numero: string
  registro: { id: string; descrizione: string }
  verso: VersoPesata
  modo: ModoPesatura
  stato: StatoAccesso
  automezzo: { id: string; targa: string; targaRimorchio: string | null } | null
  targa: string | null
  targaRimorchio: string | null
  cerCode: string | null
  descrizione: string | null
  note: string | null
  apertoIl: string
  chiusoIl: string | null
  annullatoIl: string | null
  motivoAnnullamento: string | null
  pesate: PesataVista[]
  netto: EsitoNetto
  collegamenti: CollegamentoVista[]
  avvisi: string[]
  giaRegistrata?: true
}

export interface AccessoRiepilogo {
  id: string
  numero: string
  stato: StatoAccesso
  verso: VersoPesata
  modo: ModoPesatura
  targa: string | null
  cerCode: string | null
  apertoIl: string
  nettoKg: number | null
  qualita: QualitaNetto | null
  manuale: boolean
  rettificato: boolean
  collegato: boolean
}

export interface ElencoAccessi extends Permessi {
  righe: AccessoRiepilogo[]
  totale: number
  pagina?: number
}

export interface FiltriAccessi {
  registroId?: string
  stato?: StatoAccesso
  /** AAAA-MM-GG */
  dal?: string
  al?: string
  targa?: string
  pagina?: number
}

export interface DatiPesataManuale {
  pesoKg: number
  strumentoId?: string | null
  strumentoEsterno?: string | null
  alibiId?: string | null
  /** ISO 8601 con offset */
  oraStrumento?: string | null
  motivo: string
  stabileDichiarato: true
}

export interface DatiAperturaAccesso {
  chiaveIdempotenza: string
  registroId?: string | null
  verso: VersoPesata
  modo: ModoPesatura
  automezzoId?: string | null
  targa?: string | null
  targaRimorchio?: string | null
  cerCode?: string | null
  descrizione?: string | null
  note?: string | null
  pesata: DatiPesataManuale
}

export interface DatiSecondaPesata {
  chiaveIdempotenza: string
  pesata: DatiPesataManuale
}

export interface DatiRettifica {
  pesoNuovoKg: number
  motivo: string
}

export interface DatiCollegamento {
  tipo: 'FIR' | 'MOVIMENTO'
  firId?: string
  movimentoId?: string
}

/** Corpo multipart: `dati` = JSON, `allegato` = file facoltativo (campi come il backend). */
export function costruisciMultipart(
  dati: unknown,
  allegato?: Blob | null,
  nomeFile?: string
): FormData {
  const f = new FormData()
  f.append('dati', JSON.stringify(dati))
  if (allegato) f.append('allegato', allegato, nomeFile ?? (allegato as File).name ?? 'allegato')
  return f
}

/** Client delle pese: anagrafiche (strumenti, automezzi) e accessi. */
@Injectable({ providedIn: 'root' })
export class PeseService {
  private readonly API_URL = `${environment.apiUrl}/pese`

  constructor(private http: HttpClient) {}

  // --- strumenti ---------------------------------------------------------------------------
  elencaStrumenti(): Observable<ElencoConPermessi<StrumentoPesa>> {
    return this.http.get<ElencoConPermessi<StrumentoPesa>>(`${this.API_URL}/strumenti`)
  }
  creaStrumento(dati: DatiStrumento): Observable<StrumentoPesa> {
    return this.http.post<StrumentoPesa>(`${this.API_URL}/strumenti`, dati)
  }
  aggiornaStrumento(id: string, dati: DatiStrumento): Observable<StrumentoPesa> {
    return this.http.put<StrumentoPesa>(`${this.API_URL}/strumenti/${id}`, dati)
  }

  // --- automezzi ---------------------------------------------------------------------------
  elencaAutomezzi(targa?: string): Observable<ElencoConPermessi<Automezzo>> {
    const params = targa ? new HttpParams().set('targa', targa) : new HttpParams()
    return this.http.get<ElencoConPermessi<Automezzo>>(`${this.API_URL}/automezzi`, { params })
  }
  creaAutomezzo(dati: DatiAutomezzo): Observable<Automezzo> {
    return this.http.post<Automezzo>(`${this.API_URL}/automezzi`, dati)
  }
  aggiornaAutomezzo(id: string, dati: DatiAutomezzo): Observable<Automezzo> {
    return this.http.put<Automezzo>(`${this.API_URL}/automezzi/${id}`, dati)
  }
  impostaTara(id: string, richiesta: RichiestaTara): Observable<Automezzo> {
    return this.http.put<Automezzo>(`${this.API_URL}/automezzi/${id}/tara`, richiesta)
  }

  // --- accessi -----------------------------------------------------------------------------
  elencaAccessi(filtri: FiltriAccessi = {}): Observable<ElencoAccessi> {
    let params = new HttpParams()
    for (const [k, v] of Object.entries(filtri)) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v))
    }
    return this.http.get<ElencoAccessi>(`${this.API_URL}/accessi`, { params })
  }
  dettaglioAccesso(id: string): Observable<AccessoVista> {
    return this.http.get<AccessoVista>(`${this.API_URL}/accessi/${id}`)
  }
  apriAccesso(dati: DatiAperturaAccesso, allegato?: Blob | null): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(
      `${this.API_URL}/accessi`,
      costruisciMultipart(dati, allegato)
    )
  }
  secondaPesata(
    accessoId: string,
    dati: DatiSecondaPesata,
    allegato?: Blob | null
  ): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(
      `${this.API_URL}/accessi/${accessoId}/seconda-pesata`,
      costruisciMultipart(dati, allegato)
    )
  }
  annullaAccesso(accessoId: string, motivo: string): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(`${this.API_URL}/accessi/${accessoId}/annulla`, { motivo })
  }
  rettificaPesata(
    pesataId: string,
    dati: DatiRettifica,
    allegato?: Blob | null
  ): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(
      `${this.API_URL}/pesate/${pesataId}/rettifiche`,
      costruisciMultipart(dati, allegato)
    )
  }
  collega(accessoId: string, dati: DatiCollegamento): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(`${this.API_URL}/accessi/${accessoId}/collegamenti`, dati)
  }
  revocaCollegamento(collegamentoId: string, motivo: string): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(`${this.API_URL}/collegamenti/${collegamentoId}/revoca`, {
      motivo,
    })
  }

  /** URL dell'allegato, da aprire in una nuova scheda (il cookie di sessione autentica). */
  urlAllegato(id: string): string {
    return `${this.API_URL}/allegati/${id}`
  }
}
