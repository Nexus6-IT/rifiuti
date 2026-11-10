import { STATI_RITIRO, FASCE_RITIRO, type StatoRitiro, type FasciaRitiro } from './tipi'

export const QUANTITA_PRESUNTA_MASSIMA = 99_999_999.99
export const ORDINE_GIRO_MASSIMO = 32_767
export const MOTIVO_LUNGHEZZA_MASSIMA = 500

export type CodiceErroreRitiro =
  | 'DATA_NON_VALIDA'
  | 'QUANTITA_NON_VALIDA'
  | 'ORDINE_GIRO_NON_VALIDO'
  | 'FASCIA_NON_VALIDA'
  | 'STATO_NON_VALIDO'
  | 'MOTIVO_OBBLIGATORIO'
  | 'MOTIVO_NON_AMMESSO'
  | 'MOTIVO_TROPPO_LUNGO'

export interface InputValidazioneRitiro {
  /** 'AAAA-MM-GG' */
  dataPrevista: string
  quantitaPresunta: number
  fascia?: FasciaRitiro | null
  ordineGiro?: number | null
  stato?: StatoRitiro
  motivo?: string | null
}

/** True se `data` è un giorno di calendario valido nel formato 'AAAA-MM-GG'. */
export function giornoValido(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false
  const [a, m, g] = data.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, g))
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === g
}

/**
 * Regole del ritiro, le stesse dei CHECK del database: quantità > 0 con due decimali al più,
 * ordine nel giro intero positivo (smallint), motivo presente se e solo se lo stato è
 * NON_ESEGUITO o ANNULLATO. Restituisce tutti i codici di errore trovati (vuoto = valido).
 */
export function validaRitiro(input: InputValidazioneRitiro): CodiceErroreRitiro[] {
  const errori: CodiceErroreRitiro[] = []

  if (!giornoValido(input.dataPrevista)) errori.push('DATA_NON_VALIDA')

  const q = input.quantitaPresunta
  const centesimi = Math.round(q * 100)
  if (
    !Number.isFinite(q) ||
    q <= 0 ||
    q > QUANTITA_PRESUNTA_MASSIMA ||
    Math.abs(q * 100 - centesimi) > 1e-6
  ) {
    errori.push('QUANTITA_NON_VALIDA')
  }

  const ordine = input.ordineGiro
  if (
    ordine != null &&
    (!Number.isInteger(ordine) || ordine <= 0 || ordine > ORDINE_GIRO_MASSIMO)
  ) {
    errori.push('ORDINE_GIRO_NON_VALIDO')
  }

  if (input.fascia != null && !FASCE_RITIRO.includes(input.fascia)) errori.push('FASCIA_NON_VALIDA')

  const stato = input.stato ?? 'PROGRAMMATO'
  if (!STATI_RITIRO.includes(stato)) {
    errori.push('STATO_NON_VALIDO')
  } else {
    const motivo = input.motivo?.trim() ?? ''
    const serve = stato !== 'PROGRAMMATO'
    if (serve && motivo === '') errori.push('MOTIVO_OBBLIGATORIO')
    if (!serve && motivo !== '') errori.push('MOTIVO_NON_AMMESSO')
    if (motivo.length > MOTIVO_LUNGHEZZA_MASSIMA) errori.push('MOTIVO_TROPPO_LUNGO')
  }

  return errori
}
