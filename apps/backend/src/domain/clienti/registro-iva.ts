/**
 * Registri IVA sezionali delle vendite (D24, 4.1a): regole pure.
 *
 * Solo il tipo che serve al contratto (E19): codice di due cifre 01-99 e un flag
 * `ricevuteSplit` per il registro delle ricevute di split payment, che WinWaste prende dalla
 * configurazione e che non si usa per le fatture del contratto.
 *
 * Resta a 4.4/4.5: protocollo, serie e numerazione delle fatture.
 */

export interface DatiRegistroIva {
  codice: string
  descrizione: string
  ricevuteSplit: boolean
}

const MSG_NON_ESISTE = 'Il registro IVA scelto non esiste o è disattivato.'

export function normalizzaRegistro(
  g: Partial<Record<keyof DatiRegistroIva, unknown>>
): DatiRegistroIva {
  const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const codice = testo(g.codice)
  return {
    codice: /^\d$/.test(codice) ? `0${codice}` : codice,
    descrizione: testo(g.descrizione),
    ricevuteSplit: g.ricevuteSplit === true || g.ricevuteSplit === 'true',
  }
}

export function validaRegistro(d: DatiRegistroIva): string[] {
  const errori: string[] = []
  if (!/^(0[1-9]|[1-9]\d)$/.test(d.codice)) {
    errori.push('Il codice del registro IVA è di due cifre, da 01 a 99.')
  }
  if (d.descrizione === '') errori.push('Indica la descrizione.')
  else if (d.descrizione.length > 60) {
    errori.push('La descrizione può avere al massimo 60 caratteri.')
  }
  return errori
}

/** Motivo per cui un registro non si puo' scegliere sul cliente o sul contratto, o null. */
export function motivoRegistroNonUsabile(
  r: { attivo: boolean; ricevuteSplit: boolean } | null
): string | null {
  if (r === null || !r.attivo) return MSG_NON_ESISTE
  if (r.ricevuteSplit) {
    return 'Il registro delle ricevute split payment non si usa per le fatture del contratto.'
  }
  return null
}
