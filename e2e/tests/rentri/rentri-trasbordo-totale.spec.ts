import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason, currentTargetIsProduction } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * FIR RENTRI in viaggio, P6 — trasbordo totale dal dettaglio del FIR, contro la fake RENTRI, COME TRASPORTATORE
 * CHE HA IN CARICO IL RIFIUTO: «Trasbordo totale» -> nuovo trasportatore dall'anagrafica, conducente, targa,
 * inizio -> invio -> il nuovo trasportatore si aggiunge al formulario e resta «in attesa della firma del nuovo
 * trasportatore» (la firma NON e' di chi invia: da qui non parte nessuna richiesta sul telefono).
 *
 * Premessa: un FIR legato a RENTRI in viaggio per cui l'ente propone `TrasbordoTotale`, il cui trasportatore e'
 * l'azienda dell'utente di test e con almeno un trasportatore in anagrafica diverso da lui. Se l'azienda non e'
 * il trasportatore del FIR il backend risponde 409 (nessuna scrittura) e lo scenario va in `skip`. La ricerca
 * del FIR avviene via API e lo scenario va in `skip` a runtime se non ce n'e' uno: mai un dato inventato. Va in
 * `skip` anche senza E2E_OPERATOR_USER/PASS. Scritture reali sull'ente: mai contro produzione.
 *
 * NB: questa spec non gira nel job e2e della CI (l'intera cartella `tests/rentri` e' esclusa perche' la fake
 * non e' avviata li'); la copertura del percorso in CI la da l'oracolo `rentri-p6-trasbordo-totale.oracolo.spec.ts`.
 */

interface FirSommario {
  id: string
  rentriNumeroFir?: string | null
}

interface Azione {
  operazione: string
}

async function token(page: import('@playwright/test').Page): Promise<string> {
  const t = await page.evaluate(() => localStorage.getItem('accessToken'))
  if (!t) throw new Error('accessToken assente in localStorage dopo il login')
  return t
}

async function trovaFir(
  page: import('@playwright/test').Page,
  conTrasbordo: boolean
): Promise<FirSommario | null> {
  const bearer = { Authorization: `Bearer ${await token(page)}` }
  const lista = await page.request.get(`${getApiUrl()}/fir?limit=100`, { headers: bearer })
  expect(lista.ok(), `GET /fir ha risposto ${lista.status()}`).toBeTruthy()
  const firs = ((await lista.json()).items ?? []) as FirSommario[]
  for (const fir of firs.filter(f => !!f.rentriNumeroFir)) {
    const r = await page.request.get(`${getApiUrl()}/rentri/fir/${fir.id}/azioni`, {
      headers: bearer,
    })
    if (!r.ok()) continue
    const { azioni } = (await r.json()) as { azioni: Azione[] }
    const ha = azioni.some(a => a.operazione === 'TrasbordoTotale')
    if (ha === conTrasbordo) return fir
  }
  return null
}

test.describe('RENTRI — trasbordo totale del FIR in viaggio (come trasportatore in carico)', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))
  test.skip(
    currentTargetIsProduction(),
    'Il trasbordo totale scrive sull’ente: mai contro produzione.'
  )

  test('«Trasbordo totale»: i dati partono, il nuovo trasportatore resta in attesa di firma e non si puo ripetere', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFir(page, true)
    test.skip(
      !fir,
      "Nessun FIR legato a RENTRI in viaggio per cui l'ente proponga il trasbordo totale."
    )

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.dichiaraTrasbordoTotale).toBeVisible()
    await detail.dichiaraTrasbordoTotale.click()
    await expect(detail.trasbordoDialog).toBeVisible()

    // Senza trasportatore, conducente e targa l'invio resta disabilitato.
    await expect(detail.trasbordoConferma).toBeDisabled()

    await detail.trasbordoTrasportatore.click()
    const opzioni = page.getByRole('option')
    const nOpzioni = await opzioni.count()
    test.skip(nOpzioni === 0, 'Nessun trasportatore in anagrafica per questa azienda.')
    await opzioni.first().click()
    await detail.trasbordoNome.fill('Luca')
    await expect(detail.trasbordoConferma).toBeDisabled()
    await detail.trasbordoCognome.fill('Bianchi')
    await expect(detail.trasbordoConferma).toBeDisabled()
    await detail.trasbordoTarga.fill('FG456HI')
    await expect(detail.trasbordoConferma).toBeEnabled()
    await detail.trasbordoConferma.click()

    // L'azienda dell'utente potrebbe non essere il trasportatore del FIR, o il nuovo coincidere con chi ha in
    // carico il rifiuto: in quel caso l'invio non parte e il dialog lo dice (nessuna scrittura sull'ente). Un
    // solo localizzatore (`or`), non due `waitFor` in gara.
    await expect(detail.trasbordoInAttesa.or(detail.trasbordoErrore)).toBeVisible({
      timeout: 30_000,
    })
    if (await detail.trasbordoErrore.isVisible()) {
      const messaggio = (await detail.trasbordoErrore.textContent()) ?? ''
      test.skip(
        /non compare fra i trasportatori|già quello che ha in carico|tua stessa azienda/i.test(
          messaggio
        ),
        `Scenario non applicabile a questo FIR: ${messaggio}`
      )
      throw new Error(`Invio del trasbordo totale rifiutato: ${messaggio}`)
    }

    // La firma e' del nuovo trasportatore: nessuna richiesta di firma per chi ha inviato, nessun secondo trasbordo.
    await expect(detail.trasbordoInAttesa).toContainText('nuovo trasportatore')
    await expect(detail.dichiaraTrasbordoTotale).toBeHidden()
    await expect(detail.firmaTrasbordoTotaleBanner).toBeHidden()
    await expect(detail.firmaRiprendi).toBeHidden()
  })

  test("un FIR per cui l'ente non propone il trasbordo totale non mostra il pulsante", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFir(page, false)
    test.skip(!fir, 'Nessun FIR legato a RENTRI senza trasbordo totale disponibile.')

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.dichiaraTrasbordoTotale).toBeHidden()
  })
})
