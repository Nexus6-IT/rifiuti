/**
 * Conti correnti del gestore (D21, 4.1a): regole pure.
 *
 * Sono le "nostre coordinate bancarie" che il cliente trova in fattura (E12, E20, tabella
 * `[BANCHE]` di WinWaste): codice breve per l'import, descrizione, banca
 * (`IstitutoFinanziario` della FatturaPA, max 80), IBAN valido e BIC facoltativo.
 *
 * Resta a 4.4: ABI e CAB si ricavano dall'IBAN italiano al momento della fattura, non si
 * salvano. L'unicita' dell'IBAN per azienda la controlla il servizio/database.
 */
import { validaCodiceTabella } from './codice-tabella'
import { ibanValido, MESSAGGIO_IBAN_NON_VALIDO, normalizzaIban } from './iban'

export interface DatiContoCorrente {
  codice: string
  descrizione: string
  banca: string
  iban: string
  bic: string | null
}

export function bicValido(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)
}

export function normalizzaContoCorrente(
  g: Partial<Record<keyof DatiContoCorrente, unknown>>
): DatiContoCorrente {
  const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const bic = testo(g.bic).toUpperCase()
  return {
    codice: testo(g.codice),
    descrizione: testo(g.descrizione),
    banca: testo(g.banca),
    iban: normalizzaIban(testo(g.iban)),
    bic: bic === '' ? null : bic,
  }
}

export function validaContoCorrente(d: DatiContoCorrente): string[] {
  const errori: string[] = []

  const mCodice = validaCodiceTabella(d.codice, 10, 'Il codice')
  if (mCodice) errori.push(mCodice)

  if (d.descrizione === '') errori.push('Indica la descrizione.')
  else if (d.descrizione.length > 100) {
    errori.push('La descrizione può avere al massimo 100 caratteri.')
  }

  if (d.banca === '') errori.push('Indica la banca.')
  else if (d.banca.length > 80) errori.push('La banca può avere al massimo 80 caratteri.')

  if (!ibanValido(d.iban)) errori.push(MESSAGGIO_IBAN_NON_VALIDO)

  if (d.bic !== null && !bicValido(d.bic)) errori.push('Il BIC non è valido.')

  return errori
}
