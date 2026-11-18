import type { AvvisoTrasmissioneSdi } from './codici'

const MS_GIORNO = 86_400_000
/** TD01 e TD04: la fattura immediata va emessa entro 12 giorni dalla data del documento. */
const GIORNI_TERMINE_IMMEDIATA = 12
/** TD24 (differita): entro il 15 del mese successivo. */
const GIORNO_TERMINE_DIFFERITA = 15

/** Codici di scarto che indicano un documento probabilmente gia' passato: 00404 fattura duplicata, 00002 nome file duplicato. */
const CODICI_DUPLICATO: readonly string[] = ['00404', '00002']

function giorniFra(da: string, a: string): number {
  const [y1, m1, d1] = da.split('-').map(Number)
  const [y2, m2, d2] = a.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / MS_GIORNO)
}

/** `AAAA-MM-15` del mese successivo a `dataDocumento` (`AAAA-MM-GG`). */
function termineDifferita(dataDocumento: string): string {
  const [anno, mese] = dataDocumento.split('-').map(Number)
  const a = mese === 12 ? anno + 1 : anno
  const m = mese === 12 ? 1 : mese + 1
  return `${a}-${String(m).padStart(2, '0')}-${GIORNO_TERMINE_DIFFERITA}`
}

export interface DatiInvio {
  tipoDocumento: string
  /** `AAAA-MM-GG`. */
  dataDocumento: string
  /** Giorno dell'invio, `AAAA-MM-GG`. */
  dataInvio: string
}

/** `INVIO_OLTRE_TERMINE`: solo un avviso, non blocca l'invio. */
export function avvisiInvio(d: DatiInvio): AvvisoTrasmissioneSdi[] {
  const oltre =
    d.tipoDocumento === 'TD24'
      ? d.dataInvio > termineDifferita(d.dataDocumento)
      : giorniFra(d.dataDocumento, d.dataInvio) > GIORNI_TERMINE_IMMEDIATA
  return oltre ? ['INVIO_OLTRE_TERMINE'] : []
}

/**
 * `PROBABILMENTE_GIA_INVIATA`: lo scarto dice «duplicato», quindi il documento puo' essere gia'
 * passato da un altro canale. La UI non propone l'annullo ma una verifica manuale.
 */
export function avvisiScarto(codiciErrore: readonly string[]): AvvisoTrasmissioneSdi[] {
  return codiciErrore.some(c => CODICI_DUPLICATO.includes(c)) ? ['PROBABILMENTE_GIA_INVIATA'] : []
}
