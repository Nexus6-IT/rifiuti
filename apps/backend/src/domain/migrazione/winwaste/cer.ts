import { errore, Esito, ok } from './risultato'

/**
 * `CER` (6 cifre) + `TIPOL`: il codice con spazi e l'asterisco se la
 * tipologia e' `P` o `Q` (pericoloso; `docs/formulari.md` §2.1 col. 30-34).
 * Il confronto col catalogo CER si fa in 3.4, non qui. Vuoto = assente.
 */
export interface CerDecodificato {
  readonly codice: string
  readonly pericoloso: boolean
}

export type CodiceCer = 'CER_FORMATO'

export function decodificaCer(
  cer: string | null,
  tipol: string | null
): Esito<CerDecodificato | null, CodiceCer> {
  const t = (cer ?? '').trim()
  if (t === '') return ok(null)
  if (!/^\d{6}$/.test(t)) return errore('CER_FORMATO', 'CER: attese 6 cifre')
  const tp = (tipol ?? '').trim().toUpperCase()
  const pericoloso = tp === 'P' || tp === 'Q'
  const codice = `${t.slice(0, 2)} ${t.slice(2, 4)} ${t.slice(4, 6)}${pericoloso ? '*' : ''}`
  return ok({ codice, pericoloso })
}
