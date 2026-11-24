import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason, currentTargetIsProduction } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * FIR RENTRI in viaggio, P4 — annotazione dal dettaglio del FIR, contro la fake RENTRI:
 * «Aggiungi un'annotazione» -> testo -> invio -> richiesta di firma sul telefono (una sola) -> banner di ripresa.
 *
 * Premessa: un FIR legato a RENTRI per cui l'ente propone `Annotazione` (viaggio avviato o formulario accettato)
 * e il cui CF dell'azienda compare fra i soggetti. Come le altre suite del ciclo di vita, la ricerca del FIR
 * avviene via API e lo scenario va in `skip` a runtime se il tenant di test non ne ha uno: mai un dato
 * inventato. Va in `skip` anche senza E2E_OPERATOR_USER/PASS. Scritture reali sull'ente: mai contro produzione.
 *
 * La firma remota chiede la conferma sull'app RENTRI FIR Digitale: con la fake la conferma si simula dal canale
 * di controllo, quindi qui si verifica il percorso fino alla richiesta di firma e la sua ripresa.
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
  conAnnotazione: boolean
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
    const ha = azioni.some(a => a.operazione === 'Annotazione')
    if (ha === conAnnotazione) return fir
  }
  return null
}

test.describe('RENTRI — annotazione del FIR in viaggio', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))
  test.skip(currentTargetIsProduction(), "L'annotazione scrive sull'ente: mai contro produzione.")

  test("«Aggiungi un'annotazione»: il testo parte, la firma si chiede una sola volta e il banner la riprende", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFir(page, true)
    test.skip(
      !fir,
      "Nessun FIR legato a RENTRI per cui l'ente proponga l'annotazione (viaggio avviato o accettato)."
    )

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.aggiungiAnnotazione).toBeVisible()
    await detail.aggiungiAnnotazione.click()
    await expect(detail.annotazioneDialog).toBeVisible()

    // Vuoto o di soli spazi: l'invio resta disabilitato; il contatore segue il testo (limite 10.000).
    await expect(detail.annotazioneConferma).toBeDisabled()
    await detail.annotazioneTesto.fill('   ')
    await expect(detail.annotazioneConferma).toBeDisabled()
    await detail.annotazioneTesto.fill("Il carico e' stato pesato due volte alla partenza.")
    await expect(detail.annotazioneContatore).toContainText('/ 10000')
    await expect(detail.annotazioneConferma).toBeEnabled()

    await detail.annotazioneConferma.click()

    // Senza la conferma sul telefono la richiesta resta in attesa: il banner di P1 prende il posto del
    // pulsante e non permette una seconda annotazione ne' una seconda richiesta di firma.
    await expect(detail.firmaInAttesa).toBeVisible({ timeout: 30_000 })
    await expect(detail.aggiungiAnnotazione).toBeHidden()
    await expect(detail.firmaRiprendi).toBeVisible()
  })

  test("un FIR per cui l'ente non propone l'annotazione non mostra il pulsante", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFir(page, false)
    test.skip(!fir, 'Nessun FIR legato a RENTRI senza annotazione disponibile.')

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.aggiungiAnnotazione).toBeHidden()
  })
})
