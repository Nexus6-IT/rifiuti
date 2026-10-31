/**
 * Stato di trasmissione di un'annotazione del registro a RENTRI: etichette, severità e testi.
 *
 * Regola di prodotto: un'annotazione è "confermata" SOLO quando RENTRI l'ha confermata
 * (`TRASMESSA`) o è stata dichiarata già presente (`GIA_SU_RENTRI`). Un invio accettato ma non
 * ancora confermata, o di esito ignoto, non si presenta mai come confermata.
 */

export type StatoRentri =
  | 'DA_TRASMETTERE'
  | 'IN_INVIO'
  | 'ATTESA_ESITO'
  | 'INCERTA'
  | 'TRASMESSA'
  | 'GIA_SU_RENTRI'
  | 'RIFIUTATA'
  | 'NON_TRASMISSIBILE'

export const STATI_RENTRI: StatoRentri[] = [
  'DA_TRASMETTERE',
  'IN_INVIO',
  'ATTESA_ESITO',
  'INCERTA',
  'TRASMESSA',
  'GIA_SU_RENTRI',
  'RIFIUTATA',
  'NON_TRASMISSIBILE',
]

export type SeveritaTag = 'success' | 'info' | 'warning' | 'danger' | 'secondary'

const ETICHETTE: Record<StatoRentri, string> = {
  DA_TRASMETTERE: 'Da trasmettere',
  IN_INVIO: 'In invio',
  ATTESA_ESITO: "In attesa dell'esito",
  INCERTA: 'Esito incerto',
  TRASMESSA: 'Trasmessa',
  GIA_SU_RENTRI: 'Già su RENTRI',
  RIFIUTATA: 'Rifiutata',
  NON_TRASMISSIBILE: 'Non trasmissibile',
}

const SEVERITA: Record<StatoRentri, SeveritaTag> = {
  DA_TRASMETTERE: 'info',
  IN_INVIO: 'info',
  ATTESA_ESITO: 'info',
  INCERTA: 'warning',
  TRASMESSA: 'success',
  GIA_SU_RENTRI: 'success',
  RIFIUTATA: 'danger',
  NON_TRASMISSIBILE: 'danger',
}

export function etichettaStatoRentri(stato: StatoRentri | null | undefined): string {
  return stato ? ETICHETTE[stato] : 'Non trasmessa'
}

/** Etichetta della riga in coda ma esclusa dall'invio automatico (ADMIN). */
export const ETICHETTA_ESCLUSA = "Escluso dall'invio automatico"

export function tooltipEsclusione(motivo: string | null | undefined): string {
  const m = motivo?.trim()
  return `${ETICHETTA_ESCLUSA}: non parte da sola.${m ? ' Motivo: ' + m : ''}`
}

export function severitaStatoRentri(stato: StatoRentri | null | undefined): SeveritaTag {
  return stato ? SEVERITA[stato] : 'secondary'
}

/** Confermata da RENTRI (o dichiarata già presente): l'unico caso in cui si dice "confermata". */
export function eConfermata(stato: StatoRentri | null | undefined): boolean {
  return stato === 'TRASMESSA' || stato === 'GIA_SU_RENTRI'
}

/** Si può scegliere per "Trasmetti": mai trasmessa, rifiutata o non trasmissibile. */
export function eSelezionabile(stato: StatoRentri | null | undefined): boolean {
  return !stato || stato === 'RIFIUTATA' || stato === 'NON_TRASMISSIBILE'
}

/** Su queste si offre "Verifica" (interroga RENTRI). */
export function eVerificabile(stato: StatoRentri | null | undefined): boolean {
  return stato === 'INCERTA' || stato === 'ATTESA_ESITO'
}

/** Tooltip della colonna: il motivo del backend se c'è, altrimenti una spiegazione dello stato. */
export function tooltipStatoRentri(
  stato: StatoRentri | null | undefined,
  motivo: string | null | undefined
): string {
  const m = motivo?.trim()
  switch (stato) {
    case undefined:
    case null:
      return 'Non ancora trasmessa a RENTRI.'
    case 'DA_TRASMETTERE':
      return m ? `In coda per l'invio a RENTRI. ${m}` : "In coda per l'invio a RENTRI."
    case 'IN_INVIO':
      return "Invio a RENTRI in corso: l'esito non è ancora noto."
    case 'ATTESA_ESITO':
      return "Inviata a RENTRI, non ancora confermata: in attesa dell'esito. Puoi verificarla."
    case 'INCERTA':
      return `Esito incerto: verificare su RENTRI prima di trasmettere di nuovo.${m ? ' ' + m : ''}`
    case 'TRASMESSA':
      return 'Confermata da RENTRI.'
    case 'GIA_SU_RENTRI':
      return 'Dichiarata già presente su RENTRI.'
    case 'RIFIUTATA':
      return m ? `Rifiutata da RENTRI: ${m}` : 'Rifiutata da RENTRI.'
    case 'NON_TRASMISSIBILE':
      return m ? `Non trasmissibile: ${m}` : 'Non trasmissibile a RENTRI.'
  }
}

export type AvvioInvio =
  | 'AVVIATO'
  | 'SENZA_CERTIFICATO'
  | 'NIENTE_DA_INVIARE'
  | 'NON_AVVIATO'
  | 'SOSPESO'

const annotazioni = (n: number): string => (n === 1 ? '1 annotazione' : `${n} annotazioni`)

/**
 * Testo per il 202 di "Trasmetti": dice che l'invio è stato avviato o messo in coda, MAI che è
 * andato a buon fine. L'esito vero si legge dallo stato di ogni annotazione.
 */
export function descrizioneAvvio(avvio: AvvioInvio, accodate: number): string {
  switch (avvio) {
    case 'AVVIATO':
      if (accodate === 0)
        return "Nessuna nuova annotazione accodata: riprende l'invio di quelle già in coda. L'esito comparirà nella colonna RENTRI quando RENTRI avrà risposto."
      return `${annotazioni(accodate)} in coda, invio avviato. L'esito comparirà nella colonna RENTRI quando RENTRI avrà risposto.`
    case 'SENZA_CERTIFICATO':
      return `${annotazioni(accodate)} in coda, ma l'invio non è partito: manca il certificato RENTRI dell'azienda.`
    case 'NON_AVVIATO':
      return `${annotazioni(accodate)} in coda. L'invio non è stato avviato adesso e partirà al prossimo giro automatico.`
    case 'SOSPESO':
      return `${annotazioni(accodate)} in coda. Invii verso RENTRI sospesi dall'amministratore del sistema: partiranno quando saranno riattivati.`
    case 'NIENTE_DA_INVIARE':
      return 'Nessuna nuova annotazione da inviare.'
  }
}

export function descrizioneEsitoVerifica<T extends { messaggio: string }>(e: T): string {
  return e.messaggio
}
