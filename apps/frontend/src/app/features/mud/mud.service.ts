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

// ===================== Integrazioni dell'anno (Task 10) =====================

/** Specchio di `SoggettoIntegrato` (application/mud/aggregazione/mud-integrazioni.ts). */
export interface SoggettoIntegrato {
  ragioneSociale: string
  /** Vuoto solo per un destinatario estero */
  codiceFiscale: string
  nazione?: string
  confermatoPropriaAzienda?: boolean
}

/** Integrazioni salvate per l'anno (`GET mud/:year/integrazioni`). */
export interface IntegrazioniMud {
  destinatari: Record<string, SoggettoIntegrato>
  /** chiave = `anno/numero` del movimento, come la scrive il backend */
  destinatariMovimento: Record<string, SoggettoIntegrato>
  trasportatori: Record<string, SoggettoIntegrato>
  pesiSpecifici: Record<
    string,
    { cerCode: string; unita: string; kgPerUnita: number; confermatoFuoriIntervallo?: boolean }
  >
  aggiornateIl: string | null
  aggiornateDa: string | null
  /** Solo nel GET: partita IVA e CF dell'azienda, per la conferma della propria azienda */
  codiciAzienda?: string[]
}

/** Corpo del PUT: sostituisce le integrazioni dell'anno, quindi si mandano tutte le voci. */
export interface CorpoIntegrazioniMud {
  destinatari: Array<{
    ragioneSociale: string
    codiceFiscale: string
    nazione?: string
    confermaPropriaAzienda?: boolean
  }>
  destinatariMovimento: Array<{
    anno: number
    numero: number
    ragioneSociale: string
    codiceFiscale: string
    confermaPropriaAzienda?: boolean
  }>
  trasportatori: Array<{ ragioneSociale: string; codiceFiscale: string }>
  pesiSpecifici: Array<{
    cerCode: string
    unita: string
    kgPerUnita: number
    confermaFuoriIntervallo?: boolean
  }>
}

/**
 * Replica di `INTERVALLI_PESO_SPECIFICO` del backend
 * (apps/backend/src/application/mud/aggregazione/mud-integrazioni.ts), che resta la regola: il
 * PUT rifiuta un valore fuori intervallo senza conferma. Qui serve solo a mostrare l'intervallo
 * e la casella di conferma prima del salvataggio (ruling A15; lo spec fissa gli stessi valori).
 */
export const INTERVALLI_PESO_SPECIFICO: ReadonlyArray<{
  alias: readonly string[]
  min: number
  max: number
}> = [
  { alias: ['L', 'LT', 'LITRO', 'LITRI'], min: 0.1, max: 3 },
  { alias: ['M3', 'MC', 'METRI CUBI'], min: 10, max: 3000 },
]

/** Intervallo consueto per l'unità; null se non è noto (serve sempre la conferma). */
export function intervalloPesoSpecifico(unita: string): { min: number; max: number } | null {
  const u = (unita ?? '').trim().toUpperCase()
  const trovato = INTERVALLI_PESO_SPECIFICO.find(i => i.alias.includes(u))
  return trovato ? { min: trovato.min, max: trovato.max } : null
}

export function pesoSpecificoPlausibile(unita: string, kgPerUnita: number): boolean {
  const i = intervalloPesoSpecifico(unita)
  return i !== null && kgPerUnita >= i.min && kgPerUnita <= i.max
}

/**
 * CF o partita IVA come li confronta il backend (`normalizzaCodiceFiscaleSoggetto` in
 * apps/backend/src/domain/shared/codice-fiscale-soggetto.ts): maiuscolo, senza spazi e senza il
 * prefisso `IT` davanti a 11 cifre.
 */
function normalizzaCodiceFiscale(valore: string | null | undefined): string {
  const pulito = (valore ?? '').replace(/\s/g, '').toUpperCase()
  return /^IT\d{11}$/.test(pulito) ? pulito.slice(2) : pulito
}

/** Il codice è uno di quelli dell'azienda: il destinatario va confermato (A-W-13). */
export function codiceDellAzienda(codice: string, codiciAzienda: readonly string[]): boolean {
  const c = normalizzaCodiceFiscale(codice)
  return c !== '' && codiciAzienda.includes(c)
}

/** Riga della sezione Integrazioni: un bloccante da completare o una voce già salvata. */
export interface RigaIntegrazione {
  tipo: MudIntegrazioneRichiesta['tipo']
  /** Chiave del backend (`integrazione.chiave` o chiave salvata): mai ricostruita dal messaggio */
  chiave: string
  etichetta: string
  ragioneSociale: string
  codiceFiscale: string
  estero: boolean
  nazione: string
  confermaPropriaAzienda: boolean
  /** DESTINATARIO_MOVIMENTO */
  anno?: number
  numero?: number
  /** PESO_SPECIFICO */
  cerCode?: string
  unita?: string
  kgPerUnita: number | null
  confermaFuoriIntervallo: boolean
  /** PESO_SPECIFICO da un bloccante: quantità dei suoi movimenti, nell'unità */
  totaleUnita: number | null
}

function rigaVuota(
  tipo: RigaIntegrazione['tipo'],
  chiave: string,
  etichetta: string
): RigaIntegrazione {
  return {
    tipo,
    chiave,
    etichetta,
    ragioneSociale: '',
    codiceFiscale: '',
    estero: false,
    nazione: '',
    confermaPropriaAzienda: false,
    kgPerUnita: null,
    confermaFuoriIntervallo: false,
    totaleUnita: null,
  }
}

const etichettaMovimento = (numero: number, anno: number) => `Movimento n. ${numero}/${anno}`
const etichettaPeso = (cerCode: string, unita: string) => `CER ${cerCode} – ${unita}`

/** Riga di un bloccante che chiede un'integrazione. */
function rigaDaBloccante(c: MudControllo): RigaIntegrazione | null {
  const i = c.integrazione
  if (!i) return null
  switch (i.tipo) {
    case 'CF_DESTINATARIO':
      return { ...rigaVuota(i.tipo, i.chiave, i.ragioneSociale), ragioneSociale: i.ragioneSociale }
    case 'CF_TRASPORTATORE':
      return {
        ...rigaVuota(i.tipo, i.chiave, `${i.ragioneSociale} (trasportatore)`),
        ragioneSociale: i.ragioneSociale,
      }
    case 'DESTINATARIO_MOVIMENTO':
      return {
        ...rigaVuota(i.tipo, i.chiave, etichettaMovimento(i.numero, i.anno)),
        anno: i.anno,
        numero: i.numero,
      }
    case 'PESO_SPECIFICO':
      return {
        ...rigaVuota(i.tipo, i.chiave, etichettaPeso(i.cerCode, i.unita)),
        cerCode: i.cerCode,
        unita: i.unita,
        totaleUnita: c.movimenti?.length ? c.movimenti.reduce((s, m) => s + m.quantita, 0) : null,
      }
  }
}

/** Completa la riga con i valori di un soggetto salvato. */
function conSoggetto(r: RigaIntegrazione, s: SoggettoIntegrato): RigaIntegrazione {
  return {
    ...r,
    ragioneSociale: s.ragioneSociale,
    codiceFiscale: s.codiceFiscale,
    estero: !!s.nazione,
    nazione: s.nazione ?? '',
    confermaPropriaAzienda: s.confermatoPropriaAzienda === true,
  }
}

/** Righe delle voci salvate, che compaiono anche quando il loro bloccante non c'è più. */
function righeSalvate(i: IntegrazioniMud): RigaIntegrazione[] {
  const righe: RigaIntegrazione[] = []
  for (const [chiave, s] of Object.entries(i.destinatari)) {
    righe.push(conSoggetto(rigaVuota('CF_DESTINATARIO', chiave, s.ragioneSociale), s))
  }
  for (const [chiave, s] of Object.entries(i.destinatariMovimento)) {
    // la chiave è quella del backend, `anno/numero`: l'etichetta la mostra come "n. numero/anno"
    const [anno, numero] = chiave.split('/').map(Number)
    const riga = rigaVuota('DESTINATARIO_MOVIMENTO', chiave, etichettaMovimento(numero, anno))
    righe.push({ ...conSoggetto(riga, s), anno, numero })
  }
  for (const [chiave, s] of Object.entries(i.trasportatori)) {
    const etichetta = `${s.ragioneSociale} (trasportatore)`
    righe.push(conSoggetto(rigaVuota('CF_TRASPORTATORE', chiave, etichetta), s))
  }
  for (const [chiave, p] of Object.entries(i.pesiSpecifici)) {
    righe.push({
      ...rigaVuota('PESO_SPECIFICO', chiave, etichettaPeso(p.cerCode, p.unita)),
      cerCode: p.cerCode,
      unita: p.unita,
      kgPerUnita: p.kgPerUnita,
      confermaFuoriIntervallo: p.confermatoFuoriIntervallo === true,
    })
  }
  return righe
}

/**
 * Righe della sezione Integrazioni: prima i bloccanti con `integrazione` (una riga per tipo e
 * chiave), poi le voci salvate che nessun bloccante richiede più. I valori salvati precompilano
 * la riga del bloccante con la stessa chiave.
 */
export function righeIntegrazioni(
  controlli: MudControllo[],
  integrazioni: IntegrazioniMud
): RigaIntegrazione[] {
  const salvate = new Map(righeSalvate(integrazioni).map(r => [`${r.tipo}|${r.chiave}`, r]))
  const righe = new Map<string, RigaIntegrazione>()
  for (const c of controlli) {
    if (c.gravita !== 'BLOCCANTE') continue
    const riga = rigaDaBloccante(c)
    if (!riga) continue
    const id = `${riga.tipo}|${riga.chiave}`
    if (righe.has(id)) continue
    const salvata = salvate.get(id)
    righe.set(
      id,
      salvata ? { ...salvata, etichetta: riga.etichetta, totaleUnita: riga.totaleUnita } : riga
    )
  }
  for (const [id, r] of salvate) if (!righe.has(id)) righe.set(id, r)
  return [...righe.values()]
}

/**
 * Corpo del PUT dalle righe: solo quelle compilate (una riga svuotata toglie la voce). Le
 * conferme si mandano solo quando servono, come le chiede il backend.
 */
export function corpoIntegrazioni(
  righe: RigaIntegrazione[],
  codiciAzienda: readonly string[]
): CorpoIntegrazioniMud {
  const corpo: CorpoIntegrazioniMud = {
    destinatari: [],
    destinatariMovimento: [],
    trasportatori: [],
    pesiSpecifici: [],
  }
  for (const r of righe) {
    const ragioneSociale = r.ragioneSociale.trim()
    const codiceFiscale = normalizzaCodiceFiscale(r.codiceFiscale)
    const conferma =
      r.confermaPropriaAzienda && codiceDellAzienda(codiceFiscale, codiciAzienda)
        ? { confermaPropriaAzienda: true }
        : {}
    switch (r.tipo) {
      case 'CF_DESTINATARIO':
        if (r.estero && r.nazione.trim()) {
          corpo.destinatari.push({ ragioneSociale, codiceFiscale: '', nazione: r.nazione.trim() })
        } else if (!r.estero && codiceFiscale) {
          corpo.destinatari.push({ ragioneSociale, codiceFiscale, ...conferma })
        }
        break
      case 'DESTINATARIO_MOVIMENTO':
        if (ragioneSociale && codiceFiscale && r.anno && r.numero) {
          corpo.destinatariMovimento.push({
            anno: r.anno,
            numero: r.numero,
            ragioneSociale,
            codiceFiscale,
            ...conferma,
          })
        }
        break
      case 'CF_TRASPORTATORE':
        // il codice della propria azienda vale senza conferma: trasporto in conto proprio
        if (codiceFiscale) corpo.trasportatori.push({ ragioneSociale, codiceFiscale })
        break
      case 'PESO_SPECIFICO':
        if (r.kgPerUnita !== null && r.kgPerUnita > 0 && r.cerCode && r.unita) {
          const fuori = !pesoSpecificoPlausibile(r.unita, r.kgPerUnita)
          corpo.pesiSpecifici.push({
            cerCode: r.cerCode,
            unita: r.unita,
            kgPerUnita: r.kgPerUnita,
            ...(fuori && r.confermaFuoriIntervallo ? { confermaFuoriIntervallo: true } : {}),
          })
        }
        break
    }
  }
  return corpo
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

  /** Integrazioni dell'anno dei dati, con i codici dell'azienda. */
  getIntegrazioni(year: number): Observable<IntegrazioniMud> {
    return this.http.get<IntegrazioniMud>(`${this.API_URL}/${year}/integrazioni`)
  }

  /** Sostituisce le integrazioni dell'anno (solo amministratori nell'azienda selezionata). */
  salvaIntegrazioni(year: number, dati: CorpoIntegrazioniMud): Observable<IntegrazioniMud> {
    return this.http.put<IntegrazioniMud>(`${this.API_URL}/${year}/integrazioni`, dati)
  }

  impostaObbligo(mudNonDovuto: boolean, motivo: string | null): Observable<ObbligoMud> {
    return this.http.put<ObbligoMud>(`${this.API_URL}/obbligo`, {
      mudNonDovuto,
      ...(motivo ? { motivo } : {}),
    })
  }
}
