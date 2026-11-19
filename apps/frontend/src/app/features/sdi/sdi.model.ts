/** Modelli dell'emissione SDI (4.5a): rispecchiano le risposte di `/sdi/configurazione`. */

export type CodiceProviderSdi = 'fake' | 'openapi' | 'invoicetronic'
export type AmbienteSdi = 'SANDBOX' | 'PRODUZIONE'

export const PROVIDER_SDI_ETICHETTE: Record<CodiceProviderSdi, string> = {
  fake: 'Prova (fake, solo collaudo)',
  openapi: 'Openapi',
  invoicetronic: 'Invoicetronic',
}

export const PASSI_ONBOARDING_ETICHETTE: Record<string, string> = {
  CONTRATTO_PROVIDER: 'Contratto con il provider firmato',
  PARTITA_IVA_CONFIGURATA: 'Partita IVA configurata presso il provider',
  CREDENZIALI_INSERITE: 'Credenziali inserite',
  WEBHOOK_CONFIGURATO: 'Webhook configurato presso il provider',
  PROVA_SANDBOX_SUPERATA: 'Prova in sandbox superata',
  AUTORIZZAZIONE_DEL_CLIENTE: 'Autorizzazione del cliente raccolta',
}

export interface ConfigurazioneSdi {
  configurata: boolean
  provider: CodiceProviderSdi | null
  ambiente: AmbienteSdi | null
  /** Credenziali proprie dell'azienda: mai il contenuto. */
  haCredenziali: boolean
  idConfigurazioneProvider: string | null
  haSegretoWebhook: boolean
  firmaDalProvider: boolean
  invioAttivo: boolean
  onboarding: Record<string, { il: string; da: string | null }>
  passiOnboarding: string[]
  verificataIl: string | null
  ultimoEsitoVerifica: string | null
  versione: number
  modificatoIl: string | null
  /** Solo nella risposta di creazione e di rigenerazione: si mostra una volta sola. */
  webhookToken?: string
}

export interface DatiConfigurazioneSdi {
  provider: string
  ambiente: string
  /** Omesso = invariate; null = account di piattaforma. */
  credenziali?: Record<string, string> | null
  idConfigurazioneProvider?: string | null
  segretoWebhook?: string | null
  firmaDalProvider?: boolean
  versione: number
}

export interface EsitoVerificaSdi {
  esito: { ok: boolean; dettaglio: string }
  configurazione: ConfigurazioneSdi
}

/** Solo ADMIN e SUPER_ADMIN modificano la configurazione SDI. */
export function puoConfigurareSdi(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}
