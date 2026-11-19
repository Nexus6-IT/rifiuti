/**
 * Corpo dell'evento salvato in `eventi_sdi_ricevuti.corpo` (4.5c). E' l'interpretazione GIA'
 * AUTENTICATA del webhook (`ProviderSdi.interpretaWebhook`), non il corpo grezzo: il job di
 * elaborazione non deve conoscere il formato di nessun provider. Scritto dalla rotta, letto dal job.
 */
import {
  ESITI_COMMITTENTE,
  TIPI_NOTIFICA_SDI,
  type EsitoCommittente,
  type TipoNotificaSdi,
} from '../../domain/fatturazione/sdi/codici'
import type { NotificaSdiGrezza } from '../fatturazione/sdi/provider-sdi.port'

export interface CorpoEventoSdi {
  idProvider: string
  notifica: {
    tipo: TipoNotificaSdi
    esitoCommittente: EsitoCommittente | null
    codiciErrore: string[]
    dataRicezioneSdi: string | null
    idNotifica: string | null
    /** XML della ricevuta in base64, se il provider lo ha dato. */
    fileBase64: string | null
  }
}

export function corpoDaNotifica(idProvider: string, n: NotificaSdiGrezza): CorpoEventoSdi {
  return {
    idProvider,
    notifica: {
      tipo: n.tipo,
      esitoCommittente: n.esitoCommittente,
      codiciErrore: n.codiciErrore,
      dataRicezioneSdi: n.dataRicezioneSdi ? n.dataRicezioneSdi.toISOString() : null,
      idNotifica: n.idNotifica,
      fileBase64: n.file ? n.file.toString('base64') : null,
    },
  }
}

/** Legge un corpo salvato; `null` se la forma non e' quella attesa (mai un'eccezione). */
export function notificaDaCorpo(
  corpo: unknown
): { idProvider: string; notifica: NotificaSdiGrezza } | null {
  if (typeof corpo !== 'object' || corpo === null) return null
  const c = corpo as { idProvider?: unknown; notifica?: unknown }
  if (typeof c.idProvider !== 'string' || c.idProvider.length === 0) return null
  if (typeof c.notifica !== 'object' || c.notifica === null) return null
  const n = c.notifica as Record<string, unknown>
  if (!(TIPI_NOTIFICA_SDI as readonly unknown[]).includes(n.tipo)) return null
  const esito = (ESITI_COMMITTENTE as readonly unknown[]).includes(n.esitoCommittente)
    ? (n.esitoCommittente as EsitoCommittente)
    : null
  let data: Date | null = null
  if (typeof n.dataRicezioneSdi === 'string') {
    const d = new Date(n.dataRicezioneSdi)
    if (Number.isNaN(d.getTime())) return null
    data = d
  }
  return {
    idProvider: c.idProvider,
    notifica: {
      tipo: n.tipo as TipoNotificaSdi,
      esitoCommittente: esito,
      codiciErrore: Array.isArray(n.codiciErrore)
        ? n.codiciErrore.filter((x): x is string => typeof x === 'string')
        : [],
      dataRicezioneSdi: data,
      idNotifica: typeof n.idNotifica === 'string' ? n.idNotifica : null,
      file: typeof n.fileBase64 === 'string' ? Buffer.from(n.fileBase64, 'base64') : null,
    },
  }
}
