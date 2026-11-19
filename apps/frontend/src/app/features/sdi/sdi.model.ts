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

// --- Invio dei documenti allo SDI (4.5b) -------------------------------------------------------

/** Stati di una trasmissione SDI: gli stessi di `apps/backend/src/domain/fatturazione/sdi/codici.ts`. */
export const STATI_TRASMISSIONE_SDI = [
  'DA_INVIARE',
  'IN_INVIO',
  'INVIATA',
  'INCERTA',
  'ERRORE_INVIO',
  'CONSEGNATA',
  'NON_CONSEGNATA',
  'SCARTATA',
  'ACCETTATA',
  'RIFIUTATA',
  'DECORSI_TERMINI',
  'NON_RECAPITABILE',
] as const
export type StatoTrasmissioneSdi = (typeof STATI_TRASMISSIONE_SDI)[number]

export type EsitoFiscaleSdi = 'EMESSA' | 'RIFIUTATA_DAL_COMMITTENTE' | 'NON_EMESSA' | 'IN_CORSO'

/** Valore del filtro «Stato SDI» che seleziona i documenti mai accodati. */
export const FILTRO_SDI_NESSUNA = 'NESSUNA'
export type FiltroStatoSdi = StatoTrasmissioneSdi | typeof FILTRO_SDI_NESSUNA

export type SeveritaSdi = 'successo' | 'info' | 'avviso' | 'errore'

/** Etichetta (italiano) e severita del badge di ogni stato. */
export const STATI_SDI_VOCI: Readonly<
  Record<StatoTrasmissioneSdi, { etichetta: string; severita: SeveritaSdi }>
> = {
  DA_INVIARE: { etichetta: 'In coda', severita: 'info' },
  IN_INVIO: { etichetta: 'In invio', severita: 'info' },
  INVIATA: { etichetta: 'Inviata', severita: 'info' },
  INCERTA: { etichetta: 'Da verificare', severita: 'avviso' },
  ERRORE_INVIO: { etichetta: 'Errore', severita: 'errore' },
  CONSEGNATA: { etichetta: 'Consegnata', severita: 'successo' },
  NON_CONSEGNATA: { etichetta: 'Non consegnata', severita: 'avviso' },
  SCARTATA: { etichetta: 'Scartata', severita: 'errore' },
  ACCETTATA: { etichetta: 'Accettata', severita: 'successo' },
  RIFIUTATA: { etichetta: 'Rifiutata', severita: 'errore' },
  DECORSI_TERMINI: { etichetta: 'Decorsi termini', severita: 'successo' },
  NON_RECAPITABILE: { etichetta: 'Non recapitabile', severita: 'avviso' },
}

/** Stati in cui la trasmissione e' ancora in lavorazione: la lista si rilegge da sola. */
export const STATI_SDI_IN_LAVORAZIONE: readonly StatoTrasmissioneSdi[] = [
  'DA_INVIARE',
  'IN_INVIO',
  'INCERTA',
]

export type MotivoSaltoSdi =
  | 'NON_TROVATO'
  | 'NON_DEFINITIVO'
  | 'TRASMISSIONE_IN_CORSO'
  | 'FIRMA_NON_DISPONIBILE'
  | 'DATA_FUTURA'
  | 'GIA_EMESSO'
  | 'XML_NON_VALIDO'

export const MOTIVI_SALTO_SDI_ETICHETTE: Readonly<Record<MotivoSaltoSdi, string>> = {
  NON_TROVATO: 'Documento non trovato',
  NON_DEFINITIVO: 'Non è un documento definitivo',
  TRASMISSIONE_IN_CORSO: 'Ha già un invio in corso o concluso',
  FIRMA_NON_DISPONIBILE: 'Fattura per la PA: la firma non è disponibile',
  DATA_FUTURA: 'La data del documento è nel futuro',
  GIA_EMESSO: 'È già stato emesso (XML scaricato): serve la conferma',
  XML_NON_VALIDO: 'L’XML non è valido',
}

export interface EsitoAccodamentoSdi {
  accodate: { documentoId: string; trasmissioneId: string; avvisi: string[] }[]
  saltate: { documentoId: string; motivo: MotivoSaltoSdi }[]
}

// --- Ricevute e cronologia (4.5c) --------------------------------------------------------------

export type TipoNotificaSdi = 'RC' | 'NS' | 'MC' | 'NE' | 'DT' | 'AT' | 'SE' | 'ERRORE_PROVIDER'
export type EsitoCommittenteSdi = 'EC01' | 'EC02'
export type FonteNotificaSdi = 'WEBHOOK' | 'POLLING' | 'INVIO'
export type AvvisoTrasmissioneSdi =
  | 'INVIO_OLTRE_TERMINE'
  | 'PROBABILMENTE_GIA_INVIATA'
  | 'NOTIFICHE_INCOERENTI'

export const TIPI_NOTIFICA_SDI_ETICHETTE: Readonly<Record<TipoNotificaSdi, string>> = {
  RC: 'Ricevuta di consegna',
  NS: 'Notifica di scarto',
  MC: 'Mancata consegna',
  NE: 'Esito del committente',
  DT: 'Decorrenza dei termini',
  AT: 'Impossibilità di recapito',
  SE: 'Scarto dell’esito',
  ERRORE_PROVIDER: 'Errore del provider',
}

export const ESITI_COMMITTENTE_ETICHETTE: Readonly<Record<EsitoCommittenteSdi, string>> = {
  EC01: 'Accettata',
  EC02: 'Rifiutata',
}

export const FONTI_NOTIFICA_ETICHETTE: Readonly<Record<FonteNotificaSdi, string>> = {
  WEBHOOK: 'Webhook',
  POLLING: 'Controllo periodico',
  INVIO: 'Invio',
}

export const AVVISI_TRASMISSIONE_ETICHETTE: Readonly<Record<AvvisoTrasmissioneSdi, string>> = {
  INVIO_OLTRE_TERMINE: 'Inviata oltre il termine di legge per l’emissione.',
  PROBABILMENTE_GIA_INVIATA:
    'Lo SDI segnala un duplicato: il documento potrebbe essere già stato inviato da un altro canale. Verifica prima di fare altro.',
  NOTIFICHE_INCOERENTI:
    'Le notifiche ricevute si contraddicono: lo stato mostrato è quello prudente. Verifica nel portale del provider.',
}

export const ESITI_FISCALI_SDI_ETICHETTE: Readonly<Record<EsitoFiscaleSdi, string>> = {
  EMESSA: 'Fattura emessa',
  RIFIUTATA_DAL_COMMITTENTE: 'Rifiutata dal committente: va gestita con una nota di credito',
  NON_EMESSA: 'Fattura non emessa',
  IN_CORSO: 'Invio in corso',
}

/** Stati in cui la pagina si rilegge da sola: l'invio non e' ancora arrivato a una ricevuta. */
export const STATI_SDI_DA_SEGUIRE: readonly StatoTrasmissioneSdi[] = [
  'DA_INVIARE',
  'IN_INVIO',
  'INCERTA',
  'INVIATA',
]

export interface NotificaSdi {
  id: string
  tipo: TipoNotificaSdi
  esitoCommittente: EsitoCommittenteSdi | null
  codiciErrore: { codice: string; descrizione: string }[]
  dataRicezioneSdi: string | null
  ricevutaIl: string
  fonte: FonteNotificaSdi
  haFile: boolean
}

export interface TrasmissioneSdi {
  id: string
  stato: StatoTrasmissioneSdi
  esitoFiscale: EsitoFiscaleSdi
  provider: string
  ambiente: string
  nomeFile: string
  creataIl: string
  inviataIl: string | null
  chiusaIl: string | null
  tentativi: number
  ultimoErroreCodice: string | null
  ultimoErroreMessaggio: string | null
  avvisi: AvvisoTrasmissioneSdi[]
  notifiche: NotificaSdi[]
}

/** Risposta di `GET /documenti-fattura/:id/sdi`. */
export interface StatoSdiDocumento {
  trasmissioni: TrasmissioneSdi[]
}
