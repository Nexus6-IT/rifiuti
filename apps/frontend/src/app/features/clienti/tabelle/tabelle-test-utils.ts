import { ComponentFixture } from '@angular/core/testing'
import { of } from 'rxjs'

/** Finto di una `Tabella` del servizio: i metodi sono spy. */
export function tabellaFinta() {
  return jasmine.createSpyObj('Tabella', ['list', 'get', 'crea', 'modifica', 'elimina'])
}

export const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

/** Bottone: il testid può stare sul <p-button> o sul <button>. */
export const bottone = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}

export function scrivi(id: string, testo: string): void {
  const el = q<HTMLInputElement>(id)!
  el.value = testo
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export async function stabilizza(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges()
  await fixture.whenStable()
  fixture.detectChanges()
}

export const risposta = <T>(v: T) => of(v)

/** Accetta la conferma di p-confirmDialog. */
export function accettaConferma(): void {
  document.body.querySelector<HTMLButtonElement>('.p-confirm-dialog-accept')!.click()
}
