import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Riga di giacenza aggregata per codice CER. */
export interface Giacenza {
  cerCode: string
  caricoKg: number
  scaricoKg: number
  giacenzaKg: number
  /** Di cui giacenza iniziale (apertura del registro), già compresa in caricoKg. */
  inizialeKg: number
  oldestCaricoDate: string | null
  /** Giacenze in unità diverse dai kg (litri, m³, ...): non si sommano ai kg. */
  altreUnita: GiacenzaAltraUnita[]
  /** Scarichi collegati a un FIR poi annullato: la giacenza li conta ancora, il MUD no. */
  scarichiSuFirAnnullati: ScaricoSuFirAnnullato[]
}

export interface GiacenzaAltraUnita {
  unita: string
  carico: number
  scarico: number
  giacenza: number
  /** Di cui giacenza iniziale (apertura del registro), già compresa in carico. */
  iniziale: number
}

export interface ScaricoSuFirAnnullato {
  numero: string
  quantita: number
  unita: string
  fir: string
}

export type OrigineEventoFifo = 'APERTURA' | 'MOVIMENTO'

/** Lotto di carico non ancora coperto dagli scarichi (FIFO del registro). */
export interface LottoResiduo {
  /** `YYYY-MM-DD` */
  giorno: string
  quantita: number
  residuo: number
  origine: OrigineEventoFifo
  riferimento: { id: string; numero?: string }
}

export type CriterioDeposito = 'NON_SCELTO' | 'TEMPORALE' | 'QUANTITATIVO'
export type OrigineSoglie = 'REGISTRO' | 'AZIENDA' | 'PREDEFINITA'

export interface SoglieDeposito {
  criterio: CriterioDeposito
  /** Soglia in giorni più severa dei tre mesi; null = nessuna soglia aggiuntiva. */
  giorniMax: number | null
  kgMaxTotale: number
  kgMaxPericolosi: number
  preavvisoGiorni: number
  preavvisoPercentuale: number
}

/** Soglie in vigore per un registro, con l'origine della riga che le ha fornite. */
export interface SoglieApplicate extends SoglieDeposito {
  origine: OrigineSoglie
}

export type TipoAvvisoDeposito =
  | 'DURATA'
  | 'DURATA_ANNUALE'
  | 'QUANTITA_TOTALE'
  | 'QUANTITA_PERICOLOSI'

export interface AvvisoDeposito {
  tipo: TipoAvvisoDeposito
  livello: 'PREAVVISO' | 'SUPERATO'
  /** null per i due avvisi quantitativi: sono del registro. */
  cerCode: string | null
  valore: number
  soglia: number
  unita: 'giorni' | 'kg'
  giornoPiuVecchio: string | null
  scadenza: string | null
  messaggio: string
}

export interface DepositoFamiglia {
  /** 'KG' (kg e tonnellate insieme) oppure l'unità normalizzata (es. 'M3'). */
  unita: string
  residuo: number
  /** Scarichi non coperti dai carichi: > 0 solo con uno storico incoerente. */
  scoperto: number
  lotti: LottoResiduo[]
  /** Lotti oltre i 50 restituiti per famiglia. */
  lottiOmessi: number
}

export interface DepositoCer {
  cerCode: string
  pericoloso: boolean
  residuoKg: number
  /** `YYYY-MM-DD` del lotto residuo più vecchio di qualunque famiglia. */
  giornoPiuVecchio: string | null
  etaGiorni: number | null
  /** `YYYY-MM-DD` entro cui avviare a recupero/smaltimento. */
  scadenza: string | null
  /** Scarichi in un'unità non di massa contro carichi in kg: il FIFO non li abbina. */
  unitaMiste: boolean
  famiglie: DepositoFamiglia[]
}

export interface DepositoRegistro {
  registroId: string
  registroDescrizione: string
  attivo: boolean
  soglie: SoglieApplicate
  cer: DepositoCer[]
  totaleKg: number
  totalePericolosiKg: number
  /** Un CER ha residuo in una famiglia non di massa (m³, litri): non entra nei kg. */
  quantitaParziale: boolean
  scopertoPresente: boolean
  avvisi: AvvisoDeposito[]
}

export interface DepositoTemporaneoVista {
  /** `YYYY-MM-DD` */
  oggi: string
  registri: DepositoRegistro[]
}

/** Soglie salvate (azienda o registro), con nota e data dell'ultimo aggiornamento. */
export interface SoglieConfigurate extends SoglieDeposito {
  note: string | null
  aggiornatoIl: string
}

export interface ConfigurazioneSoglie {
  /** Se il ruolo effettivo può modificare le soglie. */
  puoImpostare: boolean
  predefinite: SoglieDeposito
  azienda: SoglieConfigurate | null
  registri: {
    registroId: string
    registroDescrizione: string
    attivo: boolean
    soglie: SoglieConfigurate | null
  }[]
}

/** Corpo del PUT delle soglie: `giorniMax` è obbligatorio, anche se `null`. */
export interface DatiSoglie extends SoglieDeposito {
  note?: string | null
}

/** Client per giacenze, deposito temporaneo e relative soglie. */
@Injectable({ providedIn: 'root' })
export class GiacenzeService {
  private readonly API_URL = `${environment.apiUrl}/giacenze`
  private readonly SOGLIE_URL = `${this.API_URL}/deposito-temporaneo/soglie`

  constructor(private http: HttpClient) {}

  private params(registroId?: string): HttpParams {
    return registroId ? new HttpParams().set('registroId', registroId) : new HttpParams()
  }

  /** Giacenze aggregate per codice CER; senza `registroId` sommate su tutti i registri. */
  getGiacenze(registroId?: string): Observable<Giacenza[]> {
    return this.http.get<Giacenza[]>(this.API_URL, { params: this.params(registroId) })
  }

  /** Deposito temporaneo: un'entry per registro (o solo quello richiesto). */
  getDepositoTemporaneo(registroId?: string): Observable<DepositoTemporaneoVista> {
    return this.http.get<DepositoTemporaneoVista>(`${this.API_URL}/deposito-temporaneo`, {
      params: this.params(registroId),
    })
  }

  /** Soglie predefinite, dell'azienda e dei registri. */
  getSoglie(): Observable<ConfigurazioneSoglie> {
    return this.http.get<ConfigurazioneSoglie>(this.SOGLIE_URL)
  }

  private urlSoglie(registroId: string | null): string {
    return registroId ? `${this.SOGLIE_URL}/registri/${registroId}` : this.SOGLIE_URL
  }

  /** Imposta le soglie del registro, o dell'azienda con `registroId` null (solo ADMIN). */
  impostaSoglie(registroId: string | null, dati: DatiSoglie): Observable<SoglieConfigurate> {
    return this.http.put<SoglieConfigurate>(this.urlSoglie(registroId), dati)
  }

  /** Rimuove le soglie del registro, o dell'azienda con `registroId` null (solo ADMIN). */
  eliminaSoglie(registroId: string | null): Observable<void> {
    return this.http.delete<void>(this.urlSoglie(registroId))
  }
}
