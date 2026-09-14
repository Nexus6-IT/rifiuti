import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { conPrefisso } from '../../utils/run-id'
import { RentriBlocchiPage } from '../../pages/rentri-blocchi.page'

/**
 * Blocchi e scorta vidimata RENTRI (R6 Task 6) — SOLO la superficie
 * davvero raggiungibile da un utente.
 *
 * **Riduzione di portata deliberata**: `ConsumaNumeroVidimatoUseCase` non ha
 * chiamanti — l'emissione di un formulario NON consuma dalla scorta (vedi
 * `docs/superpowers/plans/2026-09-12-collegamento-scorta-emissione.md`).
 * Un test end-to-end dell'emissione con un numero vidimato proverebbe un
 * percorso che nessun utente attraversa oggi: non è qui, e il documento UAT
 * (`docs/uat/scorta-vidimata.md`) dichiara esplicitamente perché.
 *
 * **Nessuna API di creazione dei blocchi esiste** (si creano solo sul
 * portale dell'ente): come già in `rentri-aggancio-formulari.spec.ts`, dove
 * mancano dati che nessuna fixture nota può preparare in anticipo, i test
 * fanno `test.skip()` a runtime con un motivo esplicito — mai un test vuoto
 * che passa in silenzio.
 *
 * Setup via API dove possibile: qui il "setup" è solo il login (i blocchi
 * sono letti dall'ente, non creati da questa suite). Il caso 3 non crea
 * alcuna risorsa — interroga l'endpoint con un codice inventato, quindi non
 * serve registrazione/teardown in `fixtures/risorse.ts`.
 */

test.describe('RENTRI — blocchi e scorta vidimata (superficie raggiungibile)', () => {
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))

  test('la pagina dei blocchi si carica e i blocchi disattivati restano visibili, attenuati e non nascosti', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'admin')

    const blocchiPage = new RentriBlocchiPage(page)
    await blocchiPage.goto()
    await blocchiPage.expectLoaded()
    await expect(blocchiPage.loading).toBeHidden({ timeout: 15_000 })

    const nessunDisattivato = !(await blocchiPage.listDisattivati.isVisible().catch(() => false))
    test.skip(
      nessunDisattivato,
      'Nessun blocco disattivato nel tenant di test: i blocchi si creano/disattivano solo sul ' +
        'portale RENTRI, nessuna fixture nota in anticipo per prepararne uno in questo ambiente.'
    )

    // Visibile per davvero, non solo presente nel DOM: prova diretta che
    // "disattivato" non significa "nascosto" (principio del programma di
    // prodotto, v. commento nel componente "distinti ma NON nascosti").
    await expect(blocchiPage.listDisattivati).toBeVisible()

    const primaRigaDisattivata = blocchiPage.listDisattivati
      .locator('[data-testid^="rentri-blocchi-row-"]')
      .first()
    await expect(primaRigaDisattivata).toBeVisible()

    // Attenuato: opacità ridotta ma non zero (v. `.rentri-blocco-row--disattivato`
    // nel componente, opacity: 0.65) — se qualcuno la portasse a 0 o a
    // `display: none` "per pulizia", questa asserzione lo ferma.
    const opacita = await primaRigaDisattivata.evaluate(el => window.getComputedStyle(el).opacity)
    expect(Number(opacita)).toBeGreaterThan(0)
    expect(Number(opacita)).toBeLessThan(1)

    // Badge "Disattivato" presente sulla riga, a conferma che è distinguibile
    // da un blocco attivo pur restando in vista.
    await expect(primaRigaDisattivata.getByText('Disattivato')).toBeVisible()
  })

  test('il campo quantità rifiuta un lotto oltre cento prima di interrogare il server, senza il messaggio inglese del validatore', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'admin')

    const blocchiPage = new RentriBlocchiPage(page)
    await blocchiPage.goto()
    await blocchiPage.expectLoaded()
    await expect(blocchiPage.loading).toBeHidden({ timeout: 15_000 })

    const numeroBottoniVidima = await blocchiPage.vidimaButtons().count()
    test.skip(
      numeroBottoniVidima === 0,
      'Nessun blocco attivo nel tenant di test su cui aprire il dialogo di vidimazione: nessuna ' +
        'fixture nota in anticipo per prepararne uno (i blocchi si creano solo sul portale RENTRI).'
    )

    const testId = await blocchiPage.vidimaButtons().first().getAttribute('data-testid')
    const codiceBlocco = testId!.replace('rentri-blocchi-vidima-', '')

    // Nessuna richiesta deve mai partire per questo scenario: registrare
    // l'assenza è la prova che il rifiuto avviene lato client, prima del
    // server — non solo che il bottone appare disabilitato.
    let richiesteVidima = 0
    page.on('request', request => {
      if (request.url().includes('/rentri/scorta/vidima')) richiesteVidima++
    })

    await blocchiPage.apriVidimazione(codiceBlocco)

    // [max]="100" sul p-inputNumber (allineato a @Max(100) del DTO backend):
    // digitare un valore superiore aggiorna comunque il modello in tempo
    // reale (ngModel, non reactive form updateOn:'blur') e il bottone si
    // disabilita di conseguenza — prima di qualunque invio.
    await blocchiPage.vidimaInputQuantita.fill('150')
    await expect(blocchiPage.vidimaConferma).toBeDisabled()

    // Nessun messaggio in inglese del validatore di class-validator: non può
    // comparire perché la richiesta non è mai partita, ma lo si verifica
    // comunque esplicitamente, a riprova che non c'è un fallback server-side
    // silenzioso che lo mostrerebbe.
    await expect(page.getByText(/must not be greater than/i)).toHaveCount(0)

    expect(richiesteVidima).toBe(0)
  })

  test('vidimare un blocco inesistente riceve un rifiuto vero e in italiano, non un avvio accettato', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'admin')

    const token = await page.evaluate(() => localStorage.getItem('accessToken'))
    if (!token) {
      throw new Error(
        'accessToken assente in localStorage dopo il login: vedi AuthService.setSession().'
      )
    }

    // Codice inventato, con il prefisso di run per riconoscerlo a colpo
    // d'occhio nei log — non crea alcuna risorsa: nessuna registrazione in
    // fixtures/risorse.ts, nessun teardown necessario.
    const codiceInesistente = conPrefisso('blocco-inesistente')

    const risposta = await page.request.post(`${getApiUrl()}/rentri/scorta/vidima`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { codiceBlocco: codiceInesistente, quantita: 1 },
      failOnStatusCode: false,
    })

    // Rifiuto vero (404, v. AvviaVidimazioneScortaUseCase.verificaBlocco),
    // MAI il 202 "avviato" che l'endpoint darebbe per un blocco valido:
    // questa verifica preventiva è la correzione di ieri, senza questo test
    // può regredire in silenzio in un fire-and-forget che risponde sempre 202.
    expect(risposta.status(), 'Atteso un rifiuto (404), non l’accettazione (202)').toBe(404)

    const corpo = await risposta.json().catch(() => ({}))
    expect(corpo.avviato).not.toBe(true)

    const messaggio = (corpo?.message ?? '').toString()
    expect(messaggio.length).toBeGreaterThan(15)
    expect(messaggio).toMatch(/nessun blocco virtuale rentri/i)
    expect(messaggio).toContain(codiceInesistente)
    // Non un codice/messaggio grezzo in inglese: il testo è quello italiano
    // di NotFoundException lanciato da verificaBlocco, non un fallback generico.
    expect(messaggio).not.toMatch(/^[A-Z0-9_]+$/)
    expect(messaggio).not.toMatch(/not found/i)
  })
})
