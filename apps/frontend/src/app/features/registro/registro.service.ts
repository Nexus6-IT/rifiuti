import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

// ─── Modelli ────────────────────────────────────────────────────────────────

export type TipoMovimento = 'CARICO' | 'SCARICO'

export const CAUSALI_CARICO = [
  'PRODUZIONE_INTERNA',
  'INGRESSO_ESTERNO',
  'RICLASSIFICAZIONE',
  'RECUPERO_PARZIALE',
  'ALTRO_CARICO',
] as const

export const CAUSALI_SCARICO = [
  'CONFERIMENTO_TRASPORTATORE',
  'AVVIO_RECUPERO',
  'AVVIO_SMALTIMENTO',
  'CESSIONE',
  'RICLASSIFICAZIONE',
  'ALTRO_SCARICO',
] as const

export type CausaleCarico = (typeof CAUSALI_CARICO)[number]
export type CausaleScarico = (typeof CAUSALI_SCARICO)[number]
export type CausaleMovimento = CausaleCarico | CausaleScarico

/** Registro cronologico di un'azienda (uno per sede), come lo restituisce il backend. */
export interface RegistroVista {
  id: string
  unitaLocaleId: string | null
  numIscrSito: string | null
  denominazione: string
  codice: string
  attivo: boolean
  principale: boolean
}

export interface Movimento {
  id: string
  registroId?: string
  tenantId: string
  progressiveNumber: number
  progressiveYear: number
  type: TipoMovimento
  movementDate: string
  registrationDate: string
  causale: CausaleMovimento
  cerCode: string
  wasteDescription?: string
  quantity: number
  unit: string
  wastePhysicalState?: string
  wasteHazardClasses?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  firId?: string
  recordedByUserId?: string
  entryHash: string
  notes?: string
  createdAt: string
  fuoriTermine?: boolean
  ritardoGg?: number
  /** Solo nella risposta di `registra`: il FIR era già ricopiato, nessun nuovo movimento. */
  giaRegistrato?: boolean
  /** Solo nella risposta di `registra`: avvisi non bloccanti per l'operatore. */
  avvisi?: string[]
}

export interface PaginatedMovimenti {
  items: Movimento[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface RegistraMovimentoRequest {
  /** Registro (sede) del movimento; se manca decide il backend (principale o unico). */
  registroId?: string
  type: TipoMovimento
  movementDate: string
  causale: CausaleMovimento
  cerCode: string
  wasteDescription?: string
  quantity: number
  unit?: string
  wastePhysicalState?: string
  wasteHazardClasses?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  firId?: string
  notes?: string
}

export interface ListMovimentiParams {
  type?: TipoMovimento
  cerCode?: string
  causale?: CausaleMovimento
  dataFrom?: string
  dataTo?: string
  firId?: string
  registroId?: string
  page?: number
  limit?: number
}

// ─── Etichette ──────────────────────────────────────────────────────────────

export const CAUSALE_LABELS: Record<CausaleMovimento, string> = {
  PRODUZIONE_INTERNA: 'Produzione interna',
  INGRESSO_ESTERNO: 'Ingresso da esterno',
  RICLASSIFICAZIONE: 'Riclassificazione CER',
  RECUPERO_PARZIALE: 'Recupero parziale',
  ALTRO_CARICO: 'Altro carico',
  CONFERIMENTO_TRASPORTATORE: 'Conferimento a trasportatore',
  AVVIO_RECUPERO: 'Avvio a recupero (R)',
  AVVIO_SMALTIMENTO: 'Avvio a smaltimento (D)',
  CESSIONE: 'Cessione a terzi',
  ALTRO_SCARICO: 'Altro scarico',
}

export const STATI_FISICI = ['Solido', 'Liquido', 'Fangoso', 'Polvere'] as const

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class RegistroService {
  private readonly API_URL = `${environment.apiUrl}/registro`

  constructor(private readonly http: HttpClient) {}

  /** Registra un nuovo movimento di carico o scarico. */
  registra(dto: RegistraMovimentoRequest): Observable<Movimento> {
    return this.http.post<Movimento>(this.API_URL, dto)
  }

  /** Elenco dei registri dell'azienda (sola lettura). */
  listRegistri(): Observable<RegistroVista[]> {
    return this.http.get<RegistroVista[]>(`${this.API_URL}/registri`)
  }

  /** Come `listRegistri`, ma crea il registro mancante di ogni sede: solo per chi può registrare (403 agli altri). */
  assicuraRegistri(): Observable<RegistroVista[]> {
    return this.http.post<RegistroVista[]>(`${this.API_URL}/registri/assicura`, {})
  }

  /** Lista paginata del registro cronologico con filtri opzionali. */
  lista(params: ListMovimentiParams = {}): Observable<PaginatedMovimenti> {
    let httpParams = new HttpParams()
    if (params.type) httpParams = httpParams.set('type', params.type)
    if (params.cerCode) httpParams = httpParams.set('cerCode', params.cerCode)
    if (params.causale) httpParams = httpParams.set('causale', params.causale)
    if (params.dataFrom) httpParams = httpParams.set('dataFrom', params.dataFrom)
    if (params.dataTo) httpParams = httpParams.set('dataTo', params.dataTo)
    if (params.firId) httpParams = httpParams.set('firId', params.firId)
    if (params.registroId) httpParams = httpParams.set('registroId', params.registroId)
    if (params.page) httpParams = httpParams.set('page', params.page.toString())
    if (params.limit) httpParams = httpParams.set('limit', params.limit.toString())
    return this.http.get<PaginatedMovimenti>(this.API_URL, { params: httpParams })
  }

  /** Stato del progressivo iniziale del registro per l'anno (C-W-02). */
  getProgressivoIniziale(anno: number, registroId?: string): Observable<StatoProgressivoIniziale> {
    return this.http.get<StatoProgressivoIniziale>(`${this.API_URL}/progressivo-iniziale/${anno}`, {
      params: this.paramsRegistro(registroId),
    })
  }

  /** Imposta il primo numero del registro dell'anno: una volta sola, prima del primo movimento. */
  impostaProgressivoIniziale(
    anno: number,
    primoProgressivo: number,
    motivo: string,
    registroId?: string
  ): Observable<{ anno: number; primoProgressivo: number }> {
    return this.http.put<{ anno: number; primoProgressivo: number }>(
      `${this.API_URL}/progressivo-iniziale/${anno}`,
      { primoProgressivo, motivo },
      { params: this.paramsRegistro(registroId) }
    )
  }

  private paramsRegistro(registroId?: string): HttpParams {
    return registroId ? new HttpParams().set('registroId', registroId) : new HttpParams()
  }
}

// ─── Progressivo iniziale (C-W-02) ──────────────────────────────────────────

/** Risposta di GET registro/progressivo-iniziale/:anno. */
export interface StatoProgressivoIniziale {
  anno: number
  /** Null in stato neutro: il registro predefinito non si determina (più sedi, nessuna principale). */
  registroId?: string | null
  primoProgressivo: number | null
  impostatoIl: string | null
  /** Il registro dell'anno ha già movimenti: il progressivo iniziale non si imposta più. */
  haMovimenti: boolean
  /** Lo decide il backend in base al ruolo nell'azienda: il frontend non lo deduce dal token. */
  puoImpostare: boolean
  /** Come sopra, per la registrazione di un movimento (amministratore o operatore). */
  puoRegistrare: boolean
}

/** Si offre l'impostazione solo a chi può farla, se l'anno non ha movimenti né un iniziale. */
export function offrireProgressivoIniziale(stato: StatoProgressivoIniziale | null): boolean {
  return !!stato && stato.puoImpostare && !stato.haMovimenti && stato.primoProgressivo === null
}

/**
 * Si mostra la registrazione di un movimento a meno che il backend dica che l'utente è in
 * sola consultazione nell'azienda selezionata. Senza stato si mostra: il salvataggio lo
 * decide comunque il backend (403), e nasconderla per un errore di rete toglierebbe la
 * funzione principale della pagina.
 */
export function offrireRegistrazione(stato: StatoProgressivoIniziale | null): boolean {
  return stato?.puoRegistrare !== false
}

const formatoAnnoRoma = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
})

/** Anno del calendario italiano (come il backend): cambia alla mezzanotte di Roma. */
export function annoItaliano(istante: Date): number {
  return Number(formatoAnnoRoma.format(istante))
}
