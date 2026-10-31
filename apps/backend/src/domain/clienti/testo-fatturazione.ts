/**
 * Testi di fatturazione (D25, 4.1a): regole pure.
 *
 * Un testo e' un blocco di 1-16 righe da al massimo 60 caratteri con un codice di 1-3
 * caratteri `[A-Za-z0-9]` e un titolo (E24, F4 di WinWaste). Le righe vuote in coda si tolgono,
 * quelle in mezzo si conservano (servono come spaziatura). La stampa in fattura e' di 4.4.
 */
import { validaCodiceTabella } from './codice-tabella'

export interface DatiTestoFatturazione {
  codice: string
  titolo: string
  righe: string[]
}

export function normalizzaTesto(
  g: Partial<Record<keyof DatiTestoFatturazione, unknown>>
): DatiTestoFatturazione {
  const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const righe = Array.isArray(g.righe)
    ? g.righe.map(r => (typeof r === 'string' ? r.trimEnd() : ''))
    : []
  while (righe.length > 0 && righe[righe.length - 1] === '') righe.pop()
  return { codice: testo(g.codice), titolo: testo(g.titolo), righe }
}

export function validaTesto(d: DatiTestoFatturazione): string[] {
  const errori: string[] = []

  const mCodice = validaCodiceTabella(d.codice, 3, 'Il codice', '[A-Za-z0-9]')
  if (mCodice) errori.push(mCodice)

  if (d.titolo === '') errori.push('Indica il titolo.')
  else if (d.titolo.length > 60) errori.push('Il titolo può avere al massimo 60 caratteri.')

  if (d.righe.length < 1 || d.righe.length > 16 || d.righe.some(r => r.length > 60)) {
    errori.push('Il testo di fatturazione ha da 1 a 16 righe di al massimo 60 caratteri.')
  }

  return errori
}
