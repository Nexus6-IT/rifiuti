import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl, getRentriFakeUrl } from '../../utils/env'

/**
 * eREGI E2 — collegare o aprire il registro RENTRI da WasteFlow, sulla fake.
 *
 * Due percorsi dal dialog «Impostazioni RENTRI del registro» (solo amministratore):
 * 1. «Apri un nuovo registro»: attività -> conferma -> l'identificativo appare collegato.
 * 2. «Scegli dall'elenco»: un registro creato sulla fake col canale di controllo compare fra i
 *    candidati e si collega.
 *
 * Premesse che nessuna fixture nota può garantire (azienda con credenziale RENTRI e numero
 * operatore configurati, registro senza identificativo e con sede il cui numero di iscrizione è
 * noto alla fake): quando mancano il test fa `test.skip()` a runtime con il motivo.
 * NON eseguito in CI (le spec di tests/rentri/ richiedono la fake, non avviata nel job E2E).
 */

interface RegistroRentri {
  registroId: string
  identificativoRentri: string | null
  haCertificato: boolean
  numIscrSito: string | null
}

async function token(page: Page): Promise<string> {
  const t = await page.evaluate(() => localStorage.getItem('accessToken'))
  if (!t) throw new Error('accessToken assente in localStorage dopo il login')
  return t
}

async function fakeViva(request: APIRequestContext): Promise<boolean> {
  return request
    .get(`${getRentriFakeUrl()}/__salute`, { failOnStatusCode: false })
    .then(r => r.ok())
    .catch(() => false)
}

/** Primo registro dell'azienda che si può collegare (sede nota, nessun identificativo). */
async function registroCollegabile(
  request: APIRequestContext,
  auth: Record<string, string>
): Promise<RegistroRentri | undefined> {
  const api = getApiUrl()
  await request.post(`${api}/registro/registri/assicura`, { headers: auth })
  const lista = await request.get(`${api}/rentri/registro/registri`, { headers: auth })
  expect(lista.ok(), `GET /rentri/registro/registri ha risposto ${lista.status()}`).toBeTruthy()
  const registri = (await lista.json()).registri as RegistroRentri[]
  return registri.find(r => r.numIscrSito && !r.identificativoRentri && r.haCertificato)
}

async function apriDialog(page: Page): Promise<void> {
  await page.goto('/registro')
  const pulsante = page.getByTestId('rentri-impostazioni')
  await expect(pulsante).toBeVisible({ timeout: 15_000 })
  await pulsante.click()
  await expect(page.getByTestId('rentri-col')).toBeVisible()
}

test.describe('RENTRI — collegare o aprire il registro (sulla fake)', () => {
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))

  test("«Apri un nuovo registro»: il registro risulta collegato con l'identificativo della fake", async ({
    page,
    context,
    request,
  }) => {
    await loginAndSaveState(page, context, 'admin')
    const auth = { Authorization: `Bearer ${await token(page)}` }
    test.skip(!(await fakeViva(request)), 'La fake RENTRI non risponde (E2E_RENTRI_FAKE_URL).')
    const registro = await registroCollegabile(request, auth)
    test.skip(
      !registro,
      'Nessun registro con sede e credenziale RENTRI e senza identificativo in questo tenant.'
    )
    // La fake deve conoscere la sede (404 = numero di iscrizione fuori dalle sue fixture).
    const sonda = await request.post(`${getRentriFakeUrl()}/__controllo/registri/registro`, {
      data: { num_iscr_sito: registro!.numIscrSito, attivita: ['Produzione'], chiuso: true },
      failOnStatusCode: false,
    })
    test.skip(!sonda.ok(), 'La sede del registro non è fra quelle note alla fake RENTRI.')

    await apriDialog(page)
    await page.getByTestId('rentri-col-apri-nuovo').click()
    await page.getByTestId('rentri-col-att-Produzione').check()
    await page.getByTestId('rentri-col-apri-avvia').locator('button').click()
    await page.getByTestId('rentri-col-conferma-si').locator('button').click()

    await expect(page.getByTestId('rentri-col-attuale')).toContainText(/R[0-9A-Z]{10}/, {
      timeout: 15_000,
    })
    await expect(page.getByTestId('rentri-col-errore')).toHaveCount(0)

    // Il backend ha salvato l'identificativo: la pagina lo rilegge dall'API.
    const dopo = await request.get(`${getApiUrl()}/rentri/registro/registri`, { headers: auth })
    const salvato = ((await dopo.json()).registri as RegistroRentri[]).find(
      r => r.registroId === registro!.registroId
    )
    expect(salvato?.identificativoRentri).toMatch(/^R[0-9A-Z]{10}$/)
  })

  test("«Scegli dall'elenco»: un registro del portale compare fra i candidati e si collega", async ({
    page,
    context,
    request,
  }) => {
    await loginAndSaveState(page, context, 'admin')
    const auth = { Authorization: `Bearer ${await token(page)}` }
    test.skip(!(await fakeViva(request)), 'La fake RENTRI non risponde (E2E_RENTRI_FAKE_URL).')
    const registro = await registroCollegabile(request, auth)
    test.skip(
      !registro,
      'Nessun registro con sede e credenziale RENTRI e senza identificativo in questo tenant.'
    )
    const crea = await request.post(`${getRentriFakeUrl()}/__controllo/registri/registro`, {
      data: {
        num_iscr_sito: registro!.numIscrSito,
        attivita: ['Trasporto'],
        descrizione: 'Registro del portale (e2e)',
      },
      failOnStatusCode: false,
    })
    test.skip(!crea.ok(), 'La sede del registro non è fra quelle note alla fake RENTRI.')
    const identificativo = (await crea.json()).identificativo as string

    await apriDialog(page)
    await page.getByTestId('rentri-col-elenco').locator('button').click()
    await expect(page.getByTestId(`rentri-col-cand-${identificativo}`)).toBeVisible({
      timeout: 15_000,
    })
    await page.getByTestId(`rentri-col-collega-${identificativo}`).locator('button').click()
    await expect(page.getByTestId('rentri-col-attuale')).toContainText(identificativo, {
      timeout: 15_000,
    })
  })
})
