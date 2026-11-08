import { ComponentFixture } from '@angular/core/testing'

/** Azioni di riga nei test: il menu ⋯ sta nel body, si apre con un clic sul bottone della riga. */
async function assesta(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges()
  await fixture.whenStable()
  fixture.detectChanges()
}

const voci = (): HTMLElement[] =>
  Array.from(document.body.querySelectorAll<HTMLElement>('.p-menu [role="menuitem"]'))

/** Apre il menu ⋯ della riga e ne restituisce le voci (testo, nell'ordine). Il menu resta aperto. */
export async function apriMenuRiga(
  fixture: ComponentFixture<unknown>,
  riga: Element
): Promise<string[]> {
  const kebab = riga.querySelector<HTMLButtonElement>('[data-testid="azioni-altre"]')
  if (!kebab) {
    return []
  }
  kebab.click()
  await assesta(fixture)
  return voci().map(v => (v.textContent ?? '').replace(/\s+/g, ' ').trim())
}

/** Sceglie una voce del menu ⋯ della riga (testo che inizia per `etichetta`). */
export async function scegliVoceRiga(
  fixture: ComponentFixture<unknown>,
  riga: Element,
  etichetta: string
): Promise<void> {
  await apriMenuRiga(fixture, riga)
  const voce = voci().find(v => (v.textContent ?? '').trim().startsWith(etichetta))
  if (!voce) {
    throw new Error(`Voce «${etichetta}» non trovata nel menu della riga`)
  }
  voce.querySelector<HTMLElement>('.p-menuitem-link, a')?.click()
  await assesta(fixture)
}

/** Chiude un menu eventualmente rimasto aperto (i test successivi non devono trovarlo). */
export function chiudiMenuRiga(): void {
  document.body.querySelectorAll('.p-menu-overlay').forEach(m => m.remove())
}
