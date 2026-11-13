import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

// Tipi delle viste del backend (D15 del piano 4.8a). I permessi non si deducono dal token:
// li dice il backend in ogni risposta di elenco e di dettaglio.

export type FontePesata = 'STRUMENTO' | 'FILE' | 'MANUALE' | 'TARA_ANAGRAFICA' | 'SIMULATA'
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
  /** Lettura firmata da cui la pesata e' copiata (fonti STRUMENTO e SIMULATA), altrimenti null. */
  letturaId?: string | null
  /** Firma della lettura riverificata dal backend; null se la pesata non ha lettura. */
  firmaValida?: boolean | null
  /** Descrizione dell'agente che ha letto lo strumento. */
  agente?: string | null
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
  /** Almeno una pesata SIMULATA: non e' un peso reale. */
  simulato?: boolean
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

/** Pesata presa da una lettura dello strumento: il peso non si digita (4.8b). */
export interface DatiPesataDaLettura {
  letturaId: string
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
  pesata: DatiPesataManuale | DatiPesataDaLettura
}

export interface DatiSecondaPesata {
  chiaveIdempotenza: string
  pesata: DatiPesataManuale | DatiPesataDaLettura
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

// --- agenti di pesa e letture (4.8b) -----------------------------------------------------

export type StatoAgente = 'IN_ATTESA' | 'ATTIVO' | 'REVOCATO'
export type StatoStrumentoAgente = 'OK' | 'ERRORE' | 'NON_CONFIGURATO'

export interface AgenteStrumentoVista {
  id: string
  descrizione: string
  stato: StatoStrumentoAgente | null
  ultimoErrore: string | null
}

export interface AgenteVista {
  id: string
  descrizione: string
  registro: { id: string; descrizione: string } | null
  stato: StatoAgente
  abbinatoIl: string | null
  /** dato tecnico: solo per chi gestisce */
  nomeHost: string | null
  versioneAgente: string | null
  ultimoContattoIl: string | null
  inLinea: boolean
  scartoOrologioS: number | null
  codaInAttesa: number | null
  lettureScartate: number | null
  /** SHA-256 della chiave pubblica a gruppi di 4, per il riscontro a vista con l'agente */
  improntaChiave: string | null
  strumenti: AgenteStrumentoVista[]
  codiceScadeIl: string | null
  revocatoIl: string | null
  motivoRevoca: string | null
  ultimoIp: string | null
}

export interface ElencoAgenti {
  righe: AgenteVista[]
  puoGestire: boolean
}

/** Risposta di creazione e di nuovo codice: il codice si vede UNA volta. */
export interface AgenteCreato {
  agente: AgenteVista
  codice: string
  scadeIl: string
}

export interface LetturaVista {
  id: string
  strumento: { id: string; descrizione: string }
  pesoKg: number
  alibiId: string | null
  oraStrumento: string | null
  oraAgente: string
  oraRicezione: string
  simulata: boolean
  usataIn: { accessoId: string; numero: string } | null
  utilizzabile: boolean
  avvisi: string[]
  firmaValida: boolean
}

export interface FiltriLetture {
  registroId?: string
  strumentoId?: string
  libere?: boolean
  /** ISO 8601 */
  dal?: string
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

  // --- agenti di pesa ----------------------------------------------------------------------
  elencaAgenti(): Observable<ElencoAgenti> {
    return this.http.get<ElencoAgenti>(`${this.API_URL}/agenti`)
  }
  creaAgente(dati: { descrizione: string; registroId?: string | null }): Observable<AgenteCreato> {
    return this.http.post<AgenteCreato>(`${this.API_URL}/agenti`, dati)
  }
  nuovoCodiceAgente(id: string): Observable<AgenteCreato> {
    return this.http.post<AgenteCreato>(`${this.API_URL}/agenti/${id}/codice`, {})
  }
  revocaAgente(id: string, motivo: string): Observable<AgenteVista> {
    return this.http.post<AgenteVista>(`${this.API_URL}/agenti/${id}/revoca`, { motivo })
  }
  /** `agenteId` nullo libera lo strumento. */
  assegnaStrumento(strumentoId: string, agenteId: string | null): Observable<unknown> {
    return this.http.put(`${this.API_URL}/strumenti/${strumentoId}/agente`, { agenteId })
  }
  elencaLetture(filtri: FiltriLetture = {}): Observable<{ righe: LetturaVista[] }> {
    let params = new HttpParams()
    for (const [k, v] of Object.entries(filtri)) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v))
    }
    return this.http.get<{ righe: LetturaVista[] }>(`${this.API_URL}/letture`, { params })
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
  apriAccesso(
    dati: DatiAperturaAccesso,
    allegato?: Blob | null,
    nomeFile?: string
  ): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(
      `${this.API_URL}/accessi`,
      costruisciMultipart(dati, allegato, nomeFile)
    )
  }
  secondaPesata(
    accessoId: string,
    dati: DatiSecondaPesata,
    allegato?: Blob | null,
    nomeFile?: string
  ): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(
      `${this.API_URL}/accessi/${accessoId}/seconda-pesata`,
      costruisciMultipart(dati, allegato, nomeFile)
    )
  }
  annullaAccesso(accessoId: string, motivo: string): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(`${this.API_URL}/accessi/${accessoId}/annulla`, { motivo })
  }
  rettificaPesata(
    pesataId: string,
    dati: DatiRettifica,
    allegato?: Blob | null,
    nomeFile?: string
  ): Observable<AccessoVista> {
    return this.http.post<AccessoVista>(
      `${this.API_URL}/pesate/${pesataId}/rettifiche`,
      costruisciMultipart(dati, allegato, nomeFile)
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

  /**
   * Scarica l'allegato con HttpClient: l'autenticazione e' Bearer piu' azienda selezionata
   * (interceptor), quindi un link diretto in una nuova scheda non sarebbe autenticato.
   */
  scaricaAllegato(id: string): Observable<Blob> {
    return this.http.get(`${this.API_URL}/allegati/${id}`, { responseType: 'blob' })
  }

  /**
   * Apre l'allegato in una nuova scheda da un object URL, revocato dopo un minuto. Da chiamare
   * dentro il gestore del click: la scheda si apre subito (altrimenti il blocco popup la
   * fermerebbe) e riceve l'indirizzo a scaricamento finito; in caso di errore si chiude.
   */
  apriAllegato(id: string): Observable<void> {
    return new Observable<void>(osservatore => {
      const scheda = window.open('', '_blank')
      const sub = this.scaricaAllegato(id).subscribe({
        next: blob => {
          const url = URL.createObjectURL(blob)
          if (scheda) scheda.location.href = url
          else window.open(url, '_blank')
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
          osservatore.next()
          osservatore.complete()
        },
        error: err => {
          scheda?.close()
          osservatore.error(err)
        },
      })
      return () => sub.unsubscribe()
    })
  }
}
