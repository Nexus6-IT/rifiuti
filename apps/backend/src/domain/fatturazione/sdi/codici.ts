/**
 * Insiemi chiusi dell'emissione SDI (4.5a). Ripetuti nei CHECK della migration
 * `20261119100000_sdi_trasmissioni` e negli enum Prisma: il test di schema li tiene allineati.
 */

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

/** Stati raggiunti dopo che il provider ha accettato l'invio: lo stato dipende dalle notifiche. */
export const STATI_DOPO_INVIO = [
  'INVIATA',
  'CONSEGNATA',
  'NON_CONSEGNATA',
  'SCARTATA',
  'ACCETTATA',
  'RIFIUTATA',
  'DECORSI_TERMINI',
  'NON_RECAPITABILE',
] as const satisfies readonly StatoTrasmissioneSdi[]

/** RC ricevuta di consegna, NS notifica di scarto, MC mancata consegna, NE esito committente, DT decorrenza termini, AT attestazione di impossibilita' di recapito, SE scarto dell'esito, ERRORE_PROVIDER errore segnalato dal provider. */
export const TIPI_NOTIFICA_SDI = ['RC', 'NS', 'MC', 'NE', 'DT', 'AT', 'SE', 'ERRORE_PROVIDER'] as const
export type TipoNotificaSdi = (typeof TIPI_NOTIFICA_SDI)[number]

export const ESITI_COMMITTENTE = ['EC01', 'EC02'] as const
export type EsitoCommittente = (typeof ESITI_COMMITTENTE)[number]

export const FONTI_NOTIFICA_SDI = ['WEBHOOK', 'POLLING', 'INVIO'] as const
export type FonteNotificaSdi = (typeof FONTI_NOTIFICA_SDI)[number]

export const CODICI_PROVIDER_SDI = ['fake', 'openapi', 'invoicetronic'] as const
export type CodiceProviderSdi = (typeof CODICI_PROVIDER_SDI)[number]

export const AMBIENTI_SDI = ['SANDBOX', 'PRODUZIONE'] as const
export type AmbienteSdi = (typeof AMBIENTI_SDI)[number]

export const DIREZIONI_TRASMISSIONE_SDI = ['EMESSA', 'RICEVUTA'] as const

export const AVVISI_TRASMISSIONE_SDI = [
  'INVIO_OLTRE_TERMINE',
  'PROBABILMENTE_GIA_INVIATA',
  'NOTIFICHE_INCOERENTI',
] as const
export type AvvisoTrasmissioneSdi = (typeof AVVISI_TRASMISSIONE_SDI)[number]

/** Esito fiscale mostrato all'utente (§4.3). */
export type EsitoFiscale = 'EMESSA' | 'RIFIUTATA_DAL_COMMITTENTE' | 'NON_EMESSA' | 'IN_CORSO'

export const eProviderSdi = (v: unknown): v is CodiceProviderSdi =>
  typeof v === 'string' && (CODICI_PROVIDER_SDI as readonly string[]).includes(v)

export const eAmbienteSdi = (v: unknown): v is AmbienteSdi =>
  typeof v === 'string' && (AMBIENTI_SDI as readonly string[]).includes(v)
