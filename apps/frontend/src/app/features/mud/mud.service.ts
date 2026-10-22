import { Injectable } from '@angular/core'
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'
import { formattaQuantita } from '../../shared/format/formatta-quantita'

export interface MudVersion {
  year: number
  version: string
}

// Tipi specchio di quelli del backend (application/mud/aggregazione/mud-controlli.ts,
// mud-generator.service.ts, mud-presentazione.service.ts, mud-obbligo.service.ts): il frontend
// non può importarli.

export interface MudMovimentoSegnalato {
  numero: number
  anno: number
  cerCode: string
  quantita: number
  unita: string
  kg: number | null
  incluso: boolean
}

export interface VoceRiepilogoAvvisi {
  codice: string
  casi: number
  movimenti: number
  kgEsclusi: number
  kgAggiunti: number
}

export interface RiepilogoAvvisi {
  kgInMeno: number
  kgInPiu: number
  movimentiNonQuantificati: number
  voci: VoceRiepilogoAvvisi[]
  testo: string
  /** Vero se gli avvisi fanno dichiarare quantità diverse dal registro: lo decide il backend */
  cambianoQuantita: boolean
}

export type MudIntegrazioneRichiesta =
  | { tipo: 'CF_DESTINATARIO'; chiave: string; ragioneSociale: string }
  | { tipo: 'PESO_SPECIFICO'; chiave: string; cerCode: string; unita: string }
  | { tipo: 'DESTINATARIO_MOVIMENTO'; chiave: string; numero: number; anno: number }
  | { tipo: 'CF_TRASPORTATORE'; chiave: string; ragioneSociale: string }

export interface MudControllo {
  codice: string
  gravita: 'BLOCCANTE' | 'AVVISO'
  messaggio: string
  movimenti?: MudMovimentoSegnalato[]
  fir?: string[]
  integrazione?: MudIntegrazioneRichiesta
}

/** Riepilogo dell'anno (`GET mud/generate`), con il ruolo nell'azienda selezionata. */
export interface MudRiepilogo {
  year: number
  /** Una riga per CER: `cerCode` come lo legge l'utente, `count` = movimenti */
  wasteProduced: Array<{ cerCode: string; totalQuantity: number; count: number }>
  totals: { produced: number; recovery: number; disposal: number; recyclingRate: number }
  controlli: MudControllo[]
  riepilogoAvvisi: RiepilogoAvvisi
  mudNonDovuto: boolean
  ruoloEffettivo: string
}

/** File generato per l'anno, a cui si può legare la segnatura della presentazione. */
export interface EsportazioneMud {
  generatoIl: string
  versione: string | null
  avvisiConfermati: string[]
  kgInMeno: number
  kgInPiu: number
}

export interface StatoPresentazioneMud {
  year: number
  status: 'DRAFT' | 'REVIEWING' | 'SUBMITTED' | 'ARCHIVED'
  submittedAt: string | null
  datiModificatiDopoPresentazione: boolean
  fileTracciato: boolean | null
  esportazioni: EsportazioneMud[]
}

export type MotivoAnnullamento = 'SEGNATURA_ERRATA' | 'DICHIARAZIONE_DA_SOSTITUIRE'

export interface ObbligoMud {
  mudNonDovuto: boolean
  motivo: string | null
  impostatoIl: string | null
  impostatoDa: string | null
  /** Solo nel GET: se l'utente può modificarlo (regola del backend) */
  puoModificare?: boolean
}

/** Ruoli che il backend considera amministratori nell'azienda selezionata. */
const RUOLI_AMMINISTRATORE = ['ADMIN', 'SUPER_ADMIN']

export function eAmministratore(ruolo: string | null | undefined): boolean {
  return RUOLI_AMMINISTRATORE.includes(ruolo ?? '')
}

/**
 * Codici distinti degli AVVISO, in ordine alfabetico: stessa regola di
 * `codiciAvvisoDaConfermare` del backend (mud-controlli.ts), che li confronta con quelli
 * mandati all'export (ruling A15 del pre-flight).
 */
export function codiciAvvisi(controlli: MudControllo[]): string[] {
  return [...new Set(controlli.filter(c => c.gravita === 'AVVISO').map(c => c.codice))].sort()
}

/**
 * Chi può generare il file con avvisi: chiunque se gli avvisi non cambiano le quantità,
 * altrimenti solo un amministratore nell'azienda selezionata. È la regola della 403 del
 * backend (`MUD_CONFERMA_RISERVATA_AMMINISTRATORI`), letta dal flag del riepilogo.
 */
export function puoGenerareConAvvisi(
  r: Pick<RiepilogoAvvisi, 'cambianoQuantita'>,
  ruolo: string
): boolean {
  return !r.cambianoQuantita || eAmministratore(ruolo)
}

/** Testo della casella di conferma degli avvisi (Decisione 19). */
export function testoConferma(
  r: Pick<RiepilogoAvvisi, 'kgInMeno' | 'kgInPiu'>,
  azione: 'generare il file' | 'segnare il MUD come presentato'
): string {
  if (r.kgInMeno === 0 && r.kgInPiu === 0) {
    return `Ho letto gli avvisi e confermo di ${azione}.`
  }
  const parti: string[] = []
  if (r.kgInMeno > 0) parti.push(`${formattaQuantita(r.kgInMeno)} kg in meno`)
  if (r.kgInPiu > 0) parti.push(`${formattaQuantita(r.kgInPiu)} kg in più`)
  return `Confermo di ${azione} con ${parti.join(' e ')} rispetto al registro.`
}

/** Client per il MUD: riepilogo annuale, export telematico, presentazione e obbligo. */
@Injectable({ providedIn: 'root' })
export class MudService {
  private readonly API_URL = `${environment.apiUrl}/mud`

  constructor(private http: HttpClient) {}

  /** Versioni/anni di tracciato supportati. */
  getVersions(): Observable<{ versions: MudVersion[] }> {
    return this.http.get<{ versions: MudVersion[] }>(`${this.API_URL}/export/versions`)
  }

  /** Riepilogo MUD (dati aggregati e controlli) per l'anno dei dati. */
  getReport(year: number): Observable<MudRiepilogo> {
    return this.http.get<MudRiepilogo>(`${this.API_URL}/generate`, {
      params: { year: String(year) },
    })
  }

  /**
   * Scarica il file MUD telematico (text/plain) dell'anno, come blob. `avvisiConfermati` sono i
   * codici degli avvisi confermati; il parametro si omette se l'elenco è vuoto.
   */
  downloadExport(year: number, avvisiConfermati: string[]): Observable<HttpResponse<Blob>> {
    let params = new HttpParams().set('year', String(year))
    if (avvisiConfermati.length) params = params.set('avvisiConfermati', avvisiConfermati.join(','))
    return this.http.get(`${this.API_URL}/export`, {
      params,
      responseType: 'blob',
      observe: 'response',
    })
  }

  getPresentazione(year: number): Observable<StatoPresentazioneMud> {
    return this.http.get<StatoPresentazioneMud>(`${this.API_URL}/${year}/presentazione`)
  }

  /**
   * Segna il MUD come presentato, legato all'esportazione indicata (`generatoIl`; senza,
   * l'ultima). Gli avvisi confermati sono quelli del file: non si mandano.
   */
  segnaPresentato(
    year: number,
    dataPresentazione?: string,
    esportazioneGenerataIl?: string
  ): Observable<StatoPresentazioneMud> {
    return this.http.post<StatoPresentazioneMud>(`${this.API_URL}/${year}/presentazione`, {
      ...(dataPresentazione ? { dataPresentazione } : {}),
      ...(esportazioneGenerataIl ? { esportazioneGenerataIl } : {}),
    })
  }

  annullaPresentazione(
    year: number,
    motivo: MotivoAnnullamento
  ): Observable<StatoPresentazioneMud> {
    return this.http.delete<StatoPresentazioneMud>(`${this.API_URL}/${year}/presentazione`, {
      body: { motivo },
    })
  }

  getObbligo(): Observable<ObbligoMud> {
    return this.http.get<ObbligoMud>(`${this.API_URL}/obbligo`)
  }

  impostaObbligo(mudNonDovuto: boolean, motivo: string | null): Observable<ObbligoMud> {
    return this.http.put<ObbligoMud>(`${this.API_URL}/obbligo`, {
      mudNonDovuto,
      ...(motivo ? { motivo } : {}),
    })
  }
}
