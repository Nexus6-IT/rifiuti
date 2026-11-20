import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'
import { AvvioInvio, StatoRentri } from './stato-rentri'

export interface ImpostazioniRegistroRentri {
  registroId: string
  descrizione: string
  identificativoRentri: string | null
  invioAutomatico: boolean
  /** Da quando le nuove annotazioni partono da sole (ISO), null se l'invio è manuale. */
  invioAutomaticoDal: string | null
  perStato: Partial<Record<StatoRentri, number>>
  /** Movimenti mai trasmessi né accodati. */
  nonTrasmessi: number
  /** Righe in coda escluse dall'invio automatico (comprese in `perStato.DA_TRASMETTERE`). */
  escluse: number
  haCertificato: boolean
  /**
   * Termine della trasmissione mensile (fine del mese successivo all'annotazione non confermata
   * più vecchia); `null` se non c'è nulla da trasmettere. Indicativo: fonte normativa secondaria.
   */
  scadenzaTrasmissione: ScadenzaTrasmissioneRentri | null
  /** Numero di iscrizione RENTRI della sede del registro; `null` = nessuna sede (non si può collegare). */
  numIscrSito: string | null
  rentriAttivita: string[]
  rentriAttivitaRecSmalt: string[]
  /** L'apertura su RENTRI è stata richiesta e l'esito non è ancora noto. */
  aperturaInCorso: boolean
  /** Chiusura del registro su RENTRI (ISO), `null` se aperto. */
  rentriChiusoIl: string | null
}

/** Registro aperto su RENTRI, proposto per il collegamento. */
export interface CandidatoRegistroRentri {
  identificativo: string
  descrizione: string | null
  attivita: string[]
  attivitaRecSmalt: string[]
  dataCreazione: string | null
  /** Id del registro locale a cui è già collegato (`null` = libero). */
  collegatoA: string | null
  questoRegistro: boolean
}

export interface DatiApriRegistroRentri {
  attivita: string[]
  attivitaRecSmalt: string[]
  descrizione?: string
}

/** 201 aperto / ritrovato; 202 `INCERTO`: non riprovare, il backend verifica. */
export type EsitoAperturaRegistroRentri =
  | { esito: 'APERTO' | 'COLLEGATO_DOPO_VERIFICA'; impostazioni: ImpostazioniRegistroRentri }
  | { esito: 'INCERTO'; messaggio: string }

/** Attività ammesse su RENTRI (stesso elenco del backend e dei CHECK del database). */
export const ATTIVITA_REGISTRO_RENTRI: { valore: string; etichetta: string }[] = [
  { valore: 'CentroRaccolta', etichetta: 'Centro di raccolta' },
  { valore: 'Produzione', etichetta: 'Produzione' },
  { valore: 'Recupero', etichetta: 'Recupero' },
  { valore: 'Smaltimento', etichetta: 'Smaltimento' },
  { valore: 'Trasporto', etichetta: 'Trasporto' },
  { valore: 'IntermediazioneSenzaDetenzione', etichetta: 'Intermediazione senza detenzione' },
]

export interface ScadenzaTrasmissioneRentri {
  /** Mese dell'annotazione più vecchia, 'AAAA-MM'. */
  mese: string
  /** Ultimo giorno utile, 'AAAA-MM-GG'. */
  entro: string
  scaduta: boolean
  /** Giorni da oggi al termine: 0 = oggi, negativo = scaduto da N giorni. */
  giorniRimanenti: number
}

/** I due permessi li decide il backend sul ruolo effettivo nell'azienda: la UI non li deduce. */
export interface ElencoRegistriRentri {
  registri: ImpostazioniRegistroRentri[]
  puoConfigurare: boolean
  puoTrasmettere: boolean
}

export interface AllineamentoRentri {
  locali: number
  trasmessi: number
  /** null: RENTRI non ha risposto. */
  suRentri: number | null
}

export interface RispostaAccodamento {
  accodate: number
  saltate: { motivo: string; numero: number }[]
  avvio: AvvioInvio
}

export interface EsitoVerificaRentri {
  esito:
    | 'TRASMESSA'
    | 'RIFIUTATA'
    | 'DA_TRASMETTERE'
    | 'DIVERSA'
    | 'IDENTIFICATIVO_RECUPERATO'
    | 'NON_VERIFICABILE'
  stato: StatoRentri
  messaggio: string
}

export interface DatiDichiarazione {
  registroId: string
  anno: number
  daProgressivo: number
  aProgressivo: number
  motivo: string
}

export interface EsitoDichiarazione {
  dichiarate: number
  saltate: number
  saltatePerStato: Partial<Record<StatoRentri, number>>
  movimentiNellIntervallo: number
}

const MSG_GENERICO = 'Operazione su RENTRI non riuscita. Riprova fra poco.'

/** Messaggio del backend (400/403/404/409, già in italiano) o, in mancanza, uno generico. */
export function messaggioErroreRentri(err: any): string {
  const m = err?.error?.message
  if (Array.isArray(m)) return m.join(' · ')
  return typeof m === 'string' && m ? m : MSG_GENERICO
}

@Injectable({ providedIn: 'root' })
export class RentriRegistroService {
  private readonly http = inject(HttpClient)
  private readonly base = `${environment.apiUrl}/rentri/registro`

  registri(): Observable<ElencoRegistriRentri> {
    return this.http.get<ElencoRegistriRentri>(`${this.base}/registri`)
  }

  imposta(
    registroId: string,
    dati: { identificativoRentri?: string | null; invioAutomatico?: boolean }
  ): Observable<ImpostazioniRegistroRentri> {
    return this.http.put<ImpostazioniRegistroRentri>(
      `${this.base}/registri/${encodeURIComponent(registroId)}`,
      dati
    )
  }

  candidati(registroId: string): Observable<{ candidati: CandidatoRegistroRentri[] }> {
    return this.http.get<{ candidati: CandidatoRegistroRentri[] }>(
      `${this.base}/registri/${encodeURIComponent(registroId)}/rentri/candidati`
    )
  }

  collega(registroId: string, identificativo: string): Observable<ImpostazioniRegistroRentri> {
    return this.http.post<ImpostazioniRegistroRentri>(
      `${this.base}/registri/${encodeURIComponent(registroId)}/rentri/collega`,
      { identificativo }
    )
  }

  apri(registroId: string, dati: DatiApriRegistroRentri): Observable<EsitoAperturaRegistroRentri> {
    return this.http.post<EsitoAperturaRegistroRentri>(
      `${this.base}/registri/${encodeURIComponent(registroId)}/rentri/apri`,
      dati
    )
  }

  allineamento(registroId: string, anno: number): Observable<AllineamentoRentri> {
    return this.http.get<AllineamentoRentri>(
      `${this.base}/registri/${encodeURIComponent(registroId)}/allineamento`,
      { params: new HttpParams().set('anno', String(anno)) }
    )
  }

  /** 202: l'invio è solo avviato o in coda, l'esito si legge dallo stato di ogni annotazione. */
  trasmetti(registroId: string, movimentoIds: string[]): Observable<RispostaAccodamento> {
    return this.http.post<RispostaAccodamento>(`${this.base}/trasmetti`, {
      registroId,
      movimentoIds,
    })
  }

  trasmettiStorico(registroId: string, anno: number): Observable<RispostaAccodamento> {
    return this.http.post<RispostaAccodamento>(`${this.base}/trasmetti-storico`, {
      registroId,
      anno,
      conferma: true,
    })
  }

  togliDallaCoda(movimentoId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/movimenti/${encodeURIComponent(movimentoId)}/coda`)
  }

  /** Solo amministratori: l'annotazione resta in coda ma non parte da sola. */
  escludiInvioAutomatico(movimentoId: string, motivo: string): Observable<void> {
    return this.http.post<void>(
      `${this.base}/movimenti/${encodeURIComponent(movimentoId)}/escludi-invio-automatico`,
      { motivo }
    )
  }

  includiInvioAutomatico(movimentoId: string): Observable<void> {
    return this.http.post<void>(
      `${this.base}/movimenti/${encodeURIComponent(movimentoId)}/includi-invio-automatico`,
      {}
    )
  }

  verifica(movimentoId: string): Observable<EsitoVerificaRentri> {
    return this.http.post<EsitoVerificaRentri>(
      `${this.base}/movimenti/${encodeURIComponent(movimentoId)}/verifica`,
      {}
    )
  }

  dichiaraGiaSuRentri(dati: DatiDichiarazione): Observable<EsitoDichiarazione> {
    return this.http.post<EsitoDichiarazione>(`${this.base}/dichiara-gia-trasmessi`, dati)
  }
}
