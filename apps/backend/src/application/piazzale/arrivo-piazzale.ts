import {
  FIR,
  FIRStato,
  type ParteFIR,
  type StatoFormulario,
} from '../../domain/fir/aggregates/fir.aggregate'
import { normalizzaCodiceFiscaleSoggetto } from '../../domain/shared/codice-fiscale-soggetto'

/**
 * Stati ente in cui l'accettazione e' gia' stata firmata o il formulario annullato:
 * il FIR non e' piu' da lavorare al piazzale anche se lo stato interno e' ancora IN_TRANSITO.
 */
export const STATI_RENTRI_FUORI_PIAZZALE: readonly StatoFormulario[] = [
  'FirmaAccettazione',
  'FirmaAnnullamento',
]

/**
 * Unico punto del confronto "il destinatario sono io": oggi la P.IVA normalizzata
 * (maiuscolo, senza spazi, senza prefisso IT) contro i codici dell'azienda.
 */
export function eAziendaStessa(
  parte: Pick<ParteFIR, 'partitaIva'> | null | undefined,
  codiciAzienda: ReadonlySet<string>
): boolean {
  const codice = normalizzaCodiceFiscaleSoggetto(parte?.partitaIva)
  return codice !== '' && codiciAzienda.has(codice)
}

/** Un FIR e' un arrivo al piazzale se e' destinato all'azienda e non e' ancora stato accettato. */
export function eArrivoPiazzale(fir: FIR, codiciAzienda: ReadonlySet<string>): boolean {
  if (!eAziendaStessa(fir.destinatario, codiciAzienda)) return false

  // FIR solo locale: conta solo il trasporto in corso
  if (!fir.rentriNumeroFir) return fir.stato === FIRStato.IN_TRANSITO

  // FIR legato al formulario RENTRI
  const statoEnte = fir.rentriStatoFormulario
  if (fir.stato === FIRStato.IN_TRANSITO) {
    return statoEnte === null || !STATI_RENTRI_FUORI_PIAZZALE.includes(statoEnte)
  }
  return fir.stato === FIRStato.BOZZA && statoEnte === null
}

/** Toglie gli spazi e porta in maiuscolo. */
export function normalizzaRicercaPiazzale(testo: string | null | undefined): string {
  return (testo ?? '').replace(/\s/g, '').toUpperCase()
}

/** Ricerca per sottostringa su numeri FIR, targa principale e mezzi delle tratte. */
export function corrispondeRicercaPiazzale(fir: FIR, cercaNormalizzata: string): boolean {
  if (cercaNormalizzata === '') return true
  const campi = [
    fir.numeroProgressivo,
    fir.rentriNumeroFir,
    fir.trasportatore?.targaVeicolo,
    ...fir.trasportatoriAggiuntivi.map((t) => t.mezzo),
  ]
  return campi.some((c) => normalizzaRicercaPiazzale(c).includes(cercaNormalizzata))
}
