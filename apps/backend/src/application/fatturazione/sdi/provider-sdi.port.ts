/**
 * Porta del provider SDI (4.5a, piano §4.1). Nessuna dipendenza da Nest o Prisma: il dominio e il
 * job d'invio parlano solo con questa interfaccia; l'adattatore reale si sceglie per azienda
 * (`RegistroProviderSdi`) e si cambia senza toccare il resto.
 */
import type {
  AmbienteSdi,
  CodiceProviderSdi,
  EsitoCommittente,
  TipoNotificaSdi,
} from '../../../domain/fatturazione/sdi/codici'

/** Credenziali in chiaro del provider (decifrate solo al momento dell'uso, mai loggate). */
export interface CredenzialiSdi {
  apiKey?: string
  [chiave: string]: string | undefined
}

export interface ContestoProvider {
  ambiente: AmbienteSdi
  /** Null = account di piattaforma (decisione D2). */
  credenziali: CredenzialiSdi | null
  idConfigurazioneProvider: string | null
}

export interface CedenteDaVerificare {
  partitaIva: string
  codiceFiscale: string
}

export type EsitoVerifica = { ok: true; dettaglio: string } | { ok: false; dettaglio: string }

export interface FileDaInviare {
  nomeFile: string
  xml: Buffer
  /** Il provider firma il file (decisione D4). */
  firma: boolean
  /** Id della trasmissione: rende l'invio idempotente. */
  chiaveIdempotenza: string
}

export type EsitoInvio =
  | { tipo: 'ACCETTATO'; idProvider: string; idSdi: string | null; fileFirmato: Buffer | null }
  /** Errore permanente (4xx di validazione, P.IVA non configurata). */
  | { tipo: 'RIFIUTATO'; codice: string; messaggio: string }
  /** 5xx, 429, rete: si ritenta. */
  | { tipo: 'TRANSITORIO'; codice: string; ritentaDopoMs?: number }
  /** Timeout dopo l'invio dei byte: non si sa se il provider l'ha ricevuto. */
  | { tipo: 'INCERTO' }

export interface InvioTrovato {
  idProvider: string
  idSdi: string | null
}

/** Notifica come la riporta il provider, prima di entrare in `notifiche_sdi`. */
export interface NotificaSdiGrezza {
  tipo: TipoNotificaSdi
  esitoCommittente: EsitoCommittente | null
  codiciErrore: string[]
  dataRicezioneSdi: Date | null
  /** Id della notifica presso il provider/SDI, se esiste: base della chiave di idempotenza. */
  idNotifica: string | null
  /** XML della ricevuta, quando il provider lo da. */
  file: Buffer | null
}

export type EsitoWebhook =
  | {
      tipo: 'VALIDO'
      /** Id dell'evento presso il provider: idempotenza della consegna «almeno una volta». */
      idEvento: string
      idProvider: string
      notifica: NotificaSdiGrezza
    }
  | { tipo: 'NON_AUTENTICO'; motivo: 'FIRMA' | 'TIMESTAMP' | 'FORMATO' }
  /** Evento autentico ma non rilevante (per esempio un tipo che non interessa). */
  | { tipo: 'IGNORATO' }

export interface ProviderSdi {
  readonly codice: CodiceProviderSdi
  /** Prova le credenziali e la configurazione della P.IVA; nessun invio. */
  verifica(ctx: ContestoProvider, cedente: CedenteDaVerificare): Promise<EsitoVerifica>
  /** Invio idempotente: la stessa `chiaveIdempotenza` non genera un secondo invio. */
  invia(ctx: ContestoProvider, f: FileDaInviare): Promise<EsitoInvio>
  /** Riconciliazione dopo un esito incerto: cerca per chiave o nome file. */
  cerca(
    ctx: ContestoProvider,
    q: { chiaveIdempotenza: string; nomeFile: string }
  ): Promise<InvioTrovato | null>
  /** Polling di ripiego: notifiche note al provider per un invio. */
  notifiche(ctx: ContestoProvider, idProvider: string): Promise<NotificaSdiGrezza[]>
  /** Verifica (firma, segreto, timestamp) e interpreta un webhook; nessun accesso al DB. */
  interpretaWebhook(
    intestazioni: Record<string, string>,
    corpoGrezzo: Buffer,
    segreto: string,
    ora: Date
  ): EsitoWebhook
}

/** Token di iniezione dell'elenco degli adattatori (come `ADATTATORI_EXPORT`). */
export const PROVIDER_SDI = Symbol('PROVIDER_SDI')
