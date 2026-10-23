import { test, expect, type Locator } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'
import { FirListPage } from '../../pages/fir-list.page'
import { RegistryPage } from '../../pages/registry.page'

/**
 * Verifica lato UI (direttive has-permission/require-permission, cfr. audit
 * frontend §3) che un utente VIEWER non veda/non possa usare i bottoni di
 * scrittura in FIR e Anagrafiche — re-verifica dal lato UI puro dell'audit
 * RBAC già chiuso nel backend (commit 09d8fd5, vedi memoria progetto
 * rifiuti-rbac-write-gap).
 */

/**
 * Verifica che un bottone sia davvero inutilizzabile per chi non ha il
 * permesso: nascosto, oppure disabilitato in un modo che il browser applica
 * per davvero.
 *
 * NON basta `expect(locator).toBeDisabled()` sul locator del bottone: la
 * direttiva `RequirePermissionDirective` (v.
 * `features/permissions/directives/require-permission.directive.ts`)
 * imposta `disabled`/`aria-disabled` con `Renderer2` su `el.nativeElement`,
 * cioè sull'elemento su cui è dichiarata `[requirePermission]`. Se quella
 * direttiva finisse su un `<p-button>` (il caso di questi bottoni, oggi non
 * ancora gestito dalla direttiva ma il pattern strutturale da guardare),
 * l'attributo atterra sull'host custom-element, non sul `<button>` nativo
 * interno che PrimeNG genera nel suo template — un host non nativo non
 * capisce `disabled` e Playwright lo ignora quando l'asserzione guarda solo
 * il bottone nativo. Stessa classe di difetto già corretta in
 * `rentri-blocchi.page.ts` (`vidimaConferma`/`vidimaInputQuantita`, host
 * `p-inputNumber`/`p-button` vs elemento nativo interno).
 *
 * Il controllo qui è quindi robusto ad entrambi i casi: guarda lo stato
 * nativo del bottone risolto (`disabled` di un vero `<button>`) E, in più,
 * `aria-disabled="true"` su se stesso o su un antenato (compreso un host
 * `p-button` che lo avesse ricevuto).
 *
 * REGRESSIONE (trovata dal revisore, corretta 2026-09-14): `.catch(() =>
 * false)` intorno a `isVisible()` è una trappola se lasciato generico.
 * `isVisible()` rispetta la modalità stretta di Playwright: se il locator
 * risolve a PIÙ di un elemento lancia "strict mode violation", non
 * restituisce `false`. Un `.catch` che inghiotte QUALUNQUE eccezione
 * trasforma quel lancio in «nascosto» — il test passa, ma non ha verificato
 * nulla: un locator ambiguo (es. `RegistryPage.nuovoButton` prima della
 * correzione, che su `/produttori` matchava sia il bottone d'intestazione
 * sia quello — con lo stesso testo via "crea" — dello stato vuoto della
 * tabella) fa sembrare "nascosto per permesso mancante" un bottone
 * visibilissimo. Qui si distingue esplicitamente "l'elemento non esiste"
 * (nessun elemento risolto: legittimamente nascosto) da "il locator è
 * ambiguo" (più di un elemento risolto: errore del test, non del prodotto
 * sotto test) — la seconda fa fallire con un messaggio chiaro invece di
 * essere inghiottita.
 */
async function expectNonUtilizzabile(locator: Locator) {
  const conteggio = await locator.count()
  if (conteggio > 1) {
    throw new Error(
      `Locator ambiguo: risolve a ${conteggio} elementi invece di 0 o 1. ` +
        'expectNonUtilizzabile() non può decidere se "nascosto" o "visibile ma disabilitato" ' +
        'quando il locator non è univoco — rendilo univoco (es. data-testid) invece di lasciare ' +
        'che un `.catch()` generico interpreti la violazione della modalità stretta come "nascosto".'
    )
  }
  if (conteggio === 0) {
    // Nessun elemento nel DOM (es. *ngIf con la direttiva has-permission):
    // va bene, legittimamente nascosto, nessuna asserzione ulteriore.
    return
  }

  const visibile = await locator.isVisible()
  if (!visibile) {
    // Presente nel DOM ma non visibile (es. `display: none`): va bene
    // altrettanto, nessuna asserzione ulteriore necessaria.
    return
  }

  const inutilizzabile = await locator.evaluate(el => {
    if (el instanceof HTMLButtonElement && el.disabled) return true
    if (el.getAttribute('aria-disabled') === 'true') return true
    return el.closest('[aria-disabled="true"], [disabled]') !== null
  })
  expect(
    inutilizzabile,
    'bottone visibile ma né disabilitato né aria-disabled per un ruolo senza il permesso'
  ).toBe(true)
}

test.describe('VIEWER — bottoni di scrittura nascosti/disabilitati', () => {
  test.skip(!hasRoleCredentials('viewer'), skipReason('viewer'))

  test('FIR: "Nuovo FIR" non è cliccabile/visibile per VIEWER', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'viewer')
    const firList = new FirListPage(page)
    await firList.goto()
    await firList.expectLoaded()

    await expectNonUtilizzabile(firList.nuovoFirButton)
  })

  test('Anagrafiche produttori: bottone "Nuovo" non è cliccabile/visibile per VIEWER', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'viewer')
    const registry = new RegistryPage(page, 'produttori')
    await registry.goto()
    await registry.expectLoaded()

    await expectNonUtilizzabile(registry.nuovoButton)
  })
})

/**
 * Regressione — DOM statico via `page.setContent`, senza stack né login.
 * Verificato empiricamente in questa sessione (non solo scritto a memoria,
 * vedi nota sotto) con due varianti dello stesso DOM:
 *
 * 1. `getByRole('button', ...)` risolve al `<button>` nativo interno di
 *    `<p-button>`, MAI all'host. Playwright propaga correttamente
 *    `aria-disabled="true"` messo sull'host ai discendenti nativi:
 *    `toBeDisabled()` sul bottone nativo risolto da `getByRole` torna già
 *    `true` da solo, senza bisogno di `expectNonUtilizzabile`. Verificato:
 *    `await expect(page.getByRole('button', {name:'Nuovo FIR'})).toBeDisabled()`
 *    passa con `<p-button aria-disabled="true"><button>Nuovo FIR</button></p-button>`.
 *    Per questo `firList.nuovoFirButton` (`getByRole('button', ...)`, non
 *    `getByTestId` sull'host) non soffre della stessa istanza del difetto
 *    di `rentri-blocchi.page.ts` (host vs elemento nativo). `RegistryPage.nuovoButton`
 *    aveva invece un difetto DIVERSO, più grave — v. describe sotto,
 *    "locator ambiguo non deve essere inghiottito in 'nascosto'".
 * 2. La stessa asserzione fatta con `getByTestId` puntato sull'HOST
 *    `<p-button>` (il pattern realmente rotto in `rentri-blocchi.page.ts`,
 *    dove il `data-testid` è sull'host) torna `enabled`: Playwright non
 *    applica `aria-disabled` su un elemento non nativo/senza ruolo
 *    interattivo a se stesso, solo lo propaga AI discendenti. Prova qui
 *    sotto.
 *
 * `expectNonUtilizzabile` resta comunque la funzione usata nei due test
 * sopra: è una sovrainsieme robusto (copre anche un ipotetico `disabled`
 * grezzo su un antenato non-form) e rende esplicito nel codice perché la
 * combinazione host/nativo conta, invece di appoggiarsi silenziosamente a
 * un comportamento di propagazione di Playwright non documentato nel test.
 */
test.describe('RBAC — regressione: disabled/aria-disabled sull’host va risolto sul controllo reale', () => {
  test('getByRole sul bottone nativo interno riconosce già da solo l’aria-disabled ereditato dall’host p-button', async ({
    page,
  }) => {
    await page.setContent(`
      <p-button aria-disabled="true">
        <button type="button">Nuovo FIR</button>
      </p-button>
    `)

    const bottoneNativo = page.getByRole('button', { name: 'Nuovo FIR' })
    await expect(bottoneNativo).toBeDisabled()
    await expectNonUtilizzabile(bottoneNativo)
  })

  test('getByTestId sull’host p-button (pattern da NON usare) non riconosce l’host stesso come disabilitato', async ({
    page,
  }) => {
    await page.setContent(`
      <p-button data-testid="nuovo-fir" aria-disabled="true">
        <button type="button">Nuovo FIR</button>
      </p-button>
    `)

    // Prova diretta della trappola: se un domani qualcuno sostituisse
    // `getByRole` con `getByTestId` puntato sull'host (come nel pattern già
    // trovato e corretto in `rentri-blocchi.page.ts`), l'asserzione ingenua
    // sull'host darebbe un falso "abilitato" pur essendo il componente
    // marcato non disponibile.
    await expect(page.getByTestId('nuovo-fir')).not.toBeDisabled()

    // Il controllo robusto, applicato però al locator giusto (il bottone
    // nativo, non l'host), lo riconosce correttamente.
    await expectNonUtilizzabile(page.getByRole('button', { name: 'Nuovo FIR' }))
  })
})

/**
 * Regressione — trovata dal revisore (2026-09-14): `RegistryPage.nuovoButton`
 * era `getByRole('button', {name: /nuovo|aggiungi|crea/i})`, che su
 * `/produttori` matcha SIA il bottone d'intestazione SIA quello dello stato
 * vuoto della tabella (`ariaLabel="Crea nuovo produttore"`, matchato via
 * "crea"). Un locator ambiguo fa lanciare `isVisible()` per violazione
 * della modalità stretta — e il `.catch(() => false)` di prima
 * interpretava QUALUNQUE eccezione come "nascosto": il test passava senza
 * aver verificato nulla, e avrebbe continuato a passare anche il giorno in
 * cui il bottone fosse visibilissimo e cliccabile. Due prove qui, DOM
 * statico via `page.setContent`, nessuna app viva:
 *
 * 1. La riproduzione esatta del locator "ingenuo" di prima (con `.catch`
 *    generico): prova che il difetto esisteva davvero, il test passava a
 *    vuoto.
 * 2. `expectNonUtilizzabile` (versione corretta) sullo stesso locator
 *    ambiguo: deve FALLIRE con un messaggio chiaro, non inghiottire
 *    l'eccezione.
 *
 * `RegistryPage.nuovoButton` è stato corretto separatamente a
 * `getByTestId('produttori-nuovo-button')` (univoco, esiste solo sul
 * bottone d'intestazione): questo describe prova la difesa a monte,
 * indipendente dal fatto che quel locator specifico sia stato sistemato.
 */
test.describe('RBAC — regressione: locator ambiguo non deve essere inghiottito in "nascosto"', () => {
  const DOM_DUE_BOTTONI = `
    <button>Nuovo produttore</button>
    <button aria-label="Crea nuovo produttore">Nuovo produttore</button>
  `

  test('la riproduzione del bug: un .catch generico su isVisible() trasforma il locator ambiguo in "nascosto"', async ({
    page,
  }) => {
    await page.setContent(DOM_DUE_BOTTONI)
    const locatorAmbiguo = page.getByRole('button', { name: /nuovo|aggiungi|crea/i })

    await expect(locatorAmbiguo).toHaveCount(2)

    // Il `.catch` "ingenuo" di prima della correzione: qualunque eccezione,
    // compresa la violazione di modalità stretta, diventa `false`.
    const risultatoIngenuo = await locatorAmbiguo.isVisible().catch(() => false)
    expect(
      risultatoIngenuo,
      'prova che il .catch generico maschera la violazione di modalità stretta come "nascosto"'
    ).toBe(false)
  })

  test('expectNonUtilizzabile su un locator ambiguo fallisce con un messaggio chiaro, non lo dichiara "nascosto"', async ({
    page,
  }) => {
    await page.setContent(DOM_DUE_BOTTONI)
    const locatorAmbiguo = page.getByRole('button', { name: /nuovo|aggiungi|crea/i })

    await expect(expectNonUtilizzabile(locatorAmbiguo)).rejects.toThrow(/locator ambiguo/i)
  })
})
