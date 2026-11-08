import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Helper unico per i campi data dell'app (`app-campo-data`, un `p-calendar` in italiano).
 * Il campo non e' piu' un `<input type="date">`: `fill('2026-01-01')` non funziona (PrimeNG legge
 * l'input solo dopo un tasto premuto e il formato e' `gg/mm/aaaa`). Si scrive come una persona e si
 * esce dal campo: il valore arriva al form all'uscita, non a ogni tasto.
 */

/** `AAAA-MM-GG` → `gg/mm/aaaa`. */
export const dataItaliana = (iso: string): string => (iso ? iso.split('-').reverse().join('/') : '')

/** L'input interno: `campo` puo' essere l'host `app-campo-data` (anche col `data-testid`) o l'input. */
export function inputData(campo: Locator): Locator {
  return campo.locator('xpath=self::input | .//input').first()
}

/**
 * Scrive `iso` (`AAAA-MM-GG`, o `''` per svuotare) nel campo e ne esce chiudendo il pannello del
 * calendario con Tab (Escape o un click sulla maschera chiuderebbero un eventuale dialog).
 */
export async function scriviData(page: Page, campo: Locator, iso: string): Promise<void> {
  const input = inputData(campo)
  await input.click()
  await input.press('Control+A')
  if (iso) await input.pressSequentially(dataItaliana(iso))
  else await input.press('Backspace')
  // Tab: il campo perde il focus (il valore arriva al form) e PrimeNG chiude il pannello. Un click
  // fuori rischia di cadere sul pannello stesso o sulla maschera, che chiuderebbe il dialog.
  await input.press('Tab')
  await expect(page.locator('.p-datepicker')).toHaveCount(0)
  await expect(input).toHaveValue(dataItaliana(iso))
}

/** Verifica il valore mostrato dal campo (`AAAA-MM-GG` in ingresso). */
export async function aspettaData(campo: Locator, iso: string): Promise<void> {
  await expect(inputData(campo)).toHaveValue(dataItaliana(iso))
}
