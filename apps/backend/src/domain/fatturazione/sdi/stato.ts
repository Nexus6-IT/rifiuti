import {
  STATI_DOPO_INVIO,
  type AvvisoTrasmissioneSdi,
  type EsitoCommittente,
  type EsitoFiscale,
  type StatoTrasmissioneSdi,
  type TipoNotificaSdi,
} from './codici'

/** Quanto serve di una notifica per calcolare lo stato. */
export interface NotificaPerStato {
  tipo: TipoNotificaSdi
  /** Solo per `NE`. */
  esitoCommittente?: EsitoCommittente | null
}

export interface StatoCalcolato {
  stato: StatoTrasmissioneSdi
  avvisi: AvvisoTrasmissioneSdi[]
}

const DOPO_INVIO = new Set<StatoTrasmissioneSdi>(STATI_DOPO_INVIO)

/**
 * Stato di una trasmissione calcolato dall'INSIEME delle notifiche (non incrementale), quindi
 * indipendente dall'ordine di arrivo e dai duplicati. Precedenza (§4.3):
 *   NS > (NE EC02 > NE EC01 > DT > AT) > (RC > MC) > INVIATA.
 * SE ed ERRORE_PROVIDER sono informative: non cambiano lo stato. Le combinazioni impossibili
 * (NS insieme a una consegna o a un esito, EC01 insieme a EC02) non lanciano: producono l'avviso
 * `NOTIFICHE_INCOERENTI` e prevale la precedenza.
 *
 * Se la trasmissione non e' ancora (o non e' piu') nel ramo «dopo l'invio», le notifiche non si
 * applicano e lo stato resta `statoInvio`.
 */
export function statoDaNotifiche(
  statoInvio: StatoTrasmissioneSdi,
  notifiche: readonly NotificaPerStato[]
): StatoCalcolato {
  if (!DOPO_INVIO.has(statoInvio)) return { stato: statoInvio, avvisi: [] }

  const ha = (tipo: TipoNotificaSdi) => notifiche.some(n => n.tipo === tipo)
  const haEsito = (e: EsitoCommittente) =>
    notifiche.some(n => n.tipo === 'NE' && n.esitoCommittente === e)

  const avvisi: AvvisoTrasmissioneSdi[] = []
  const scartata = ha('NS')
  const incoerente =
    (scartata && (ha('RC') || ha('DT') || ha('NE'))) || (haEsito('EC01') && haEsito('EC02'))
  if (incoerente) avvisi.push('NOTIFICHE_INCOERENTI')

  let stato: StatoTrasmissioneSdi = 'INVIATA'
  if (scartata) stato = 'SCARTATA'
  else if (haEsito('EC02')) stato = 'RIFIUTATA'
  else if (haEsito('EC01')) stato = 'ACCETTATA'
  else if (ha('DT')) stato = 'DECORSI_TERMINI'
  else if (ha('AT')) stato = 'NON_RECAPITABILE'
  else if (ha('RC')) stato = 'CONSEGNATA'
  else if (ha('MC')) stato = 'NON_CONSEGNATA'
  return { stato, avvisi }
}

/**
 * Esito fiscale mostrato all'utente. B2B: una fattura non consegnata (MC) e' comunque emessa
 * (resta nel cassetto fiscale del destinatario); un rifiuto del committente (EC02) si gestisce
 * con una nota di credito.
 */
export function esitoFiscale(stato: StatoTrasmissioneSdi): EsitoFiscale {
  switch (stato) {
    case 'CONSEGNATA':
    case 'NON_CONSEGNATA':
    case 'ACCETTATA':
    case 'DECORSI_TERMINI':
    case 'NON_RECAPITABILE':
      return 'EMESSA'
    case 'RIFIUTATA':
      return 'RIFIUTATA_DAL_COMMITTENTE'
    case 'SCARTATA':
    case 'ERRORE_INVIO':
      return 'NON_EMESSA'
    case 'DA_INVIARE':
    case 'IN_INVIO':
    case 'INVIATA':
    case 'INCERTA':
      return 'IN_CORSO'
  }
}
