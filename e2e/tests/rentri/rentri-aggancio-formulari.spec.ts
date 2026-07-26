import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { RentriFormulariPage } from '../../pages/rentri-formulari.page'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * Ricerca e aggancio dei formulari RENTRI (R2 Task 9 — verifica end-to-end
 * della fase R2). Scheletro nella stessa convenzione di
 * tests/fir/fir-rentri-status.spec.ts: `test.skip()` condizionale sulle
 * credenziali (E2E_OPERATOR_USER/PASS), MAI un test vuoto che passa
 * silenziosamente. I corpi interrogano l'API con lo stesso token della
 * sessione loggata per trovare lo stato che serve (nessun dato inventato),
 * e fanno `test.skip()` a runtime quando l'ambiente non offre un modo di
 * prepararlo (nessuna fixture nota in anticipo per un formulario RENTRI
 * reale creato da un produttore terzo).
 *
 * In QUESTO ambiente E2E_OPERATOR_USER/PASS non sono impostate (v.
 * e2e/README.md, "Cosa manca"): ogni scenario qui sotto va quindi in skip
 * al primo `test.skip(!hasRoleCredentials('operator'), ...)`. È l'esito
 * atteso e corretto di questa esecuzione, non un difetto da aggirare.
 */

interface FIRSummary {
  id: string
  numeroProgressivo?: string | null
  rentriNumeroFir?: string | null
}

async function getAccessToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('accessToken'))
  if (!token) {
    throw new Error(
      'accessToken assente in localStorage dopo il login: verificare AuthService.setSession() ' +
        '(chiave "accessToken") o se il flusso di login è cambiato.'
    )
  }
  return token
}

async function listFirs(page: import('@playwright/test').Page, limit = 50): Promise<FIRSummary[]> {
  const token = await getAccessToken(page)
  const response = await page.request.get(`${getApiUrl()}/fir?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok(), `GET /fir ha risposto ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return (body.items ?? []) as FIRSummary[]
}

test.describe('RENTRI — ricerca e aggancio dei formulari', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('la ricerca dei formulari popola la tabella con le righe attese', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const rentriPage = new RentriFormulariPage(page)
    await rentriPage.goto()
    await rentriPage.expectLoaded()

    // La ricerca parte da ngOnInit se il ruolo è autorizzato: attendere che
    // esca dallo stato di caricamento prima di ispezionare il risultato.
    await expect(rentriPage.loading).toBeHidden({ timeout: 15_000 })

    const nessunRisultato = await rentriPage.emptyState.isVisible()
    test.skip(
      nessunRisultato,
      'Nessun formulario RENTRI trovato per il codice fiscale del tenant di test: ' +
        "serve un formulario reale creato da una controparte terza (produttore) sulla fake/l'ente, " +
        'nessuna fixture nota in anticipo per prepararlo in questo ambiente.'
    )

    await expect(rentriPage.table).toBeVisible()
    const primaRiga = rentriPage.table.locator('tr[data-testid^="rentri-formulari-row-"]').first()
    await expect(primaRiga).toBeVisible()
  })

  test('agganciare un formulario come NUOVO lo fa comparire nella lista FIR e ne aggiorna lo stato riga', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const rentriPage = new RentriFormulariPage(page)
    await rentriPage.goto()
    await rentriPage.expectLoaded()
    await expect(rentriPage.loading).toBeHidden({ timeout: 15_000 })

    const nessunRisultato = await rentriPage.emptyState.isVisible()
    test.skip(
      nessunRisultato,
      'Nessun formulario RENTRI da agganciare nel tenant di test: serve un formulario reale non ' +
        'ancora presente nel gestionale, nessuna fixture nota in anticipo per prepararlo qui.'
    )

    const righeDaAgganciare = rentriPage.table.locator(
      'button[data-testid^="rentri-formulari-aggancia-"]:not([disabled])'
    )
    const numeroRighe = await righeDaAgganciare.count()
    test.skip(
      numeroRighe === 0,
      'Tutti i formulari trovati risultano già agganciati nel gestionale (bottone disabilitato): ' +
        'nessun candidato per uno scenario di primo aggancio in questo giro.'
    )

    const testId = await righeDaAgganciare.first().getAttribute('data-testid')
    const numeroFir = testId!.replace('rentri-formulari-aggancia-', '')

    await rentriPage.apriDialogAggancio(numeroFir)
    await rentriPage.confirmDialogModalitaNuovo.check()
    await rentriPage.confirmDialogConfirmButton.click()

    await expect(rentriPage.confirmDialog).toBeHidden()
    await expect(rentriPage.statusBadge(numeroFir)).toHaveText(/già nel gestionale/i)

    // Verifica indipendente via API (stesso token sessione): il FIR agganciato
    // deve comparire nella lista FIR con il numero_fir appena collegato.
    const firs = await listFirs(page)
    const agganciato = firs.find(f => f.rentriNumeroFir === numeroFir)
    expect(
      agganciato,
      `Nessun FIR nella lista con rentriNumeroFir=${numeroFir} dopo l'aggancio come NUOVO`
    ).toBeTruthy()
  })

  test('agganciare a un FIR locale esistente aggiorna il numero_fir nel dettaglio di quel FIR', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const rentriPage = new RentriFormulariPage(page)
    await rentriPage.goto()
    await rentriPage.expectLoaded()
    await expect(rentriPage.loading).toBeHidden({ timeout: 15_000 })

    const nessunRisultato = await rentriPage.emptyState.isVisible()
    test.skip(
      nessunRisultato,
      'Nessun formulario RENTRI da agganciare nel tenant di test: nessuna fixture nota in anticipo.'
    )

    const righeDaAgganciare = rentriPage.table.locator(
      'button[data-testid^="rentri-formulari-aggancia-"]:not([disabled])'
    )
    const numeroRighe = await righeDaAgganciare.count()
    test.skip(numeroRighe === 0, 'Nessun formulario ancora da agganciare in questo giro.')

    const testId = await righeDaAgganciare.first().getAttribute('data-testid')
    const numeroFir = testId!.replace('rentri-formulari-aggancia-', '')

    await rentriPage.apriDialogAggancio(numeroFir)
    await rentriPage.confirmDialogModalitaEsistente.check()

    const nessunFirLibero = await rentriPage.page
      .getByText(/non ci sono fir locali ancora liberi/i)
      .isVisible()
      .catch(() => false)
    test.skip(
      nessunFirLibero,
      'Nessun FIR locale libero (senza numero RENTRI) a cui collegare il formulario trovato: ' +
        'serve una bozza esistente nel tenant di test, non presente in questo giro.'
    )

    await rentriPage.confirmDialogFirLocaleSelect.click()
    const opzione = page.locator('.p-dropdown-item').first()
    await expect(opzione).toBeVisible()
    const labelFirLocale = (await opzione.innerText()).trim()
    await opzione.click()

    await rentriPage.confirmDialogConfirmButton.click()
    await expect(rentriPage.confirmDialog).toBeHidden()

    // Il FIR selezionato è identificato dalla label (numeroProgressivo/id —
    // v. RentriFormulariComponent.onModalitaEsistenteScelta), usata qui per
    // ritrovarlo via API e navigare al dettaglio.
    const idFirLocale = labelFirLocale.split(' — ')[0].trim()
    const firs = await listFirs(page)
    const firTarget = firs.find(f => f.numeroProgressivo === idFirLocale || f.id === idFirLocale)
    expect(firTarget, `Nessun FIR trovato con identificativo "${idFirLocale}"`).toBeTruthy()

    const detail = new FirDetailPage(page)
    await detail.goto(firTarget!.id)
    await detail.expectLoaded()
    await expect(detail.rentriNumeroUfficiale).toHaveText(new RegExp(numeroFir))
  })

  test('rilasciare il legame lascia il FIR locale ma senza più il numero_fir RENTRI', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const firs = await listFirs(page)
    const firAgganciato = firs.find(f => !!f.rentriNumeroFir)
    test.skip(
      !firAgganciato,
      'Nessun FIR con un legame RENTRI rilasciabile (aggancio manuale/da terzi) nel tenant di test.'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(firAgganciato!.id)
    await detail.expectLoaded()

    const bottoneVisibile = await detail.rentriRilasciaLegame.isVisible().catch(() => false)
    test.skip(
      !bottoneVisibile,
      "Il pulsante di rilascio non è mostrato per questo FIR (probabilmente l'origine del legame è " +
        'TRASMESSO_DA_NOI, non rilasciabile — v. FirDetailComponent.canRilasciareLegameRentri): ' +
        'nessun FIR con origine rilasciabile disponibile in questo giro.'
    )

    await detail.rentriRilasciaLegame.click()
    await expect(detail.rentriRilasciaLegameConfirmDialog).toBeVisible()
    await detail.rentriRilasciaLegameConfirmDialog
      .getByRole('button', { name: /rilascia/i })
      .click()

    await expect(page.getByText(/legame.{0,10}rilasciat/i)).toBeVisible({ timeout: 10_000 })

    // Il FIR locale resta raggiungibile (stessa pagina), ma senza più il
    // numero_fir RENTRI mostrato.
    await detail.goto(firAgganciato!.id)
    await detail.expectLoaded()
    await expect(detail.rentriNumeroUfficiale).toBeHidden()
  })

  test('un secondo tentativo di aggancio sullo stesso formulario mostra un messaggio leggibile, non un codice HTTP grezzo', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')

    const rentriPage = new RentriFormulariPage(page)
    await rentriPage.goto()
    await rentriPage.expectLoaded()
    await expect(rentriPage.loading).toBeHidden({ timeout: 15_000 })

    const nessunRisultato = await rentriPage.emptyState.isVisible()
    test.skip(
      nessunRisultato,
      'Nessun formulario RENTRI nel tenant di test: nessuna fixture nota in anticipo per ' +
        'prepararne uno già agganciato con cui provocare il conflitto.'
    )

    // Un formulario "Già nel gestionale" ha il bottone Aggancia disabilitato
    // in UI (v. componente): il conflitto va quindi provocato chiamando
    // direttamente l'API con lo stesso token della sessione, aggirando solo
    // il guard client-side — non un dato inventato, un numero_fir REALE già
    // agganciato secondo la ricerca appena fatta.
    const righeAgganciate = rentriPage.table.locator(
      'button[data-testid^="rentri-formulari-aggancia-"][disabled]'
    )
    const numeroRighe = await righeAgganciate.count()
    test.skip(
      numeroRighe === 0,
      'Nessun formulario già agganciato nel tenant di test da riprovare ad agganciare.'
    )
    const testId = await righeAgganciate.first().getAttribute('data-testid')
    const numeroFir = testId!.replace('rentri-formulari-aggancia-', '')

    const token = await getAccessToken(page)
    const risposta = await page.request.post(
      `${getApiUrl()}/rentri/formulari/${numeroFir}/aggancia`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { modalita: 'NUOVO' },
      }
    )

    expect(risposta.status(), 'Atteso un conflitto di dominio (409/400), non un 200').not.toBe(200)
    const corpo = await risposta.json().catch(() => ({}))
    const messaggio = (corpo?.message ?? '').toString()

    expect(messaggio.length).toBeGreaterThan(15)
    expect(messaggio).toMatch(/gi.{0,3}(collegat|agganciat)/i)
    expect(messaggio).not.toMatch(/^[A-Z0-9_]+$/)
  })
})
