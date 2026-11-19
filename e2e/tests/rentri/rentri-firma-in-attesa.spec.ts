import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason, currentTargetIsProduction } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * FIR RENTRI in viaggio, P1 — firma in attesa di conferma sul dispositivo: il banner con «Ho
 * confermato, controlla» e «Annulla la richiesta» (reset), contro la fake RENTRI.
 *
 * Premessa: un FIR legato a RENTRI la cui firma remota e' partita e non e' ancora stata confermata
 * (il caso normale dopo «Accetta il carico» o «Annulla il formulario»: il tetto di attesa della
 * singola richiesta e' di 20 s, la conferma sul telefono richiede di piu'). Come le altre suite del
 * ciclo di vita, la ricerca del FIR avviene via API e lo scenario va in `skip` a runtime se il tenant
 * di test non ne ha uno: mai un dato inventato. Va in `skip` anche senza E2E_OPERATOR_USER/PASS.
 *
 * Scritture reali sull'ente (reset): mai contro produzione.
 */

interface FirSommario {
  id: string
  rentriNumeroFir?: string | null
}

interface SessioneInAttesa {
  id: string
  scaduta: boolean
}

async function token(page: import('@playwright/test').Page): Promise<string> {
  const t = await page.evaluate(() => localStorage.getItem('accessToken'))
  if (!t) throw new Error('accessToken assente in localStorage dopo il login')
  return t
}

/** Primo FIR legato a RENTRI con una sessione di firma aperta (e non scaduta, se richiesto). */
async function trovaFirConFirmaInAttesa(
  page: import('@playwright/test').Page,
  scaduta: boolean
): Promise<FirSommario | null> {
  const bearer = { Authorization: `Bearer ${await token(page)}` }
  const lista = await page.request.get(`${getApiUrl()}/fir?limit=100`, { headers: bearer })
  expect(lista.ok(), `GET /fir ha risposto ${lista.status()}`).toBeTruthy()
  const firs = ((await lista.json()).items ?? []) as FirSommario[]
  for (const fir of firs.filter(f => !!f.rentriNumeroFir)) {
    const r = await page.request.get(`${getApiUrl()}/rentri/fir/${fir.id}/firme/in-attesa`, {
      headers: bearer,
    })
    if (!r.ok()) continue
    const { sessione } = (await r.json()) as { sessione: SessioneInAttesa | null }
    if (sessione && sessione.scaduta === scaduta) return fir
  }
  return null
}

test.describe('RENTRI — firma in attesa: banner, ripresa e annullamento della richiesta', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('il banner compare con i due pulsanti e «Ho confermato, controlla» non lancia una seconda richiesta', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFirConFirmaInAttesa(page, false)
    test.skip(
      !fir,
      'Nessun FIR legato a RENTRI con una firma in attesa di conferma: serve un FIR su cui sia partita ' +
        'una firma remota non ancora confermata (es. «Accetta il carico» sulla fake senza confermare).'
    )

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.firmaInAttesa).toBeVisible()
    await expect(detail.firmaInAttesa).toContainText(
      "In attesa della tua conferma sull'app RENTRI FIR Digitale"
    )
    await expect(detail.firmaRiprendi).toBeVisible()
    await expect(detail.firmaAnnullaRichiesta).toBeVisible()

    // «Ho confermato, controlla» senza aver confermato sul telefono: un messaggio, il banner resta.
    await detail.firmaRiprendi.click()
    await expect(page.getByText(/firma non ancora confermata/i)).toBeVisible({ timeout: 15_000 })
    await expect(detail.firmaInAttesa).toBeVisible()
  })

  test('«Annulla la richiesta» cancella i dati non firmati e fa sparire il banner', async ({
    page,
    context,
  }) => {
    test.skip(
      currentTargetIsProduction(),
      "Il reset cancella dati sull'ente: mai contro produzione."
    )
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFirConFirmaInAttesa(page, false)
    test.skip(!fir, 'Nessun FIR legato a RENTRI con una firma in attesa di conferma.')

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()
    await expect(detail.firmaInAttesa).toBeVisible()

    await detail.firmaAnnullaRichiesta.click()
    await page.getByRole('button', { name: 'Annulla la richiesta' }).last().click()

    await expect(page.getByText(/richiesta annullata/i)).toBeVisible({ timeout: 15_000 })
    await expect(detail.firmaInAttesa).toBeHidden()
  })

  test('una richiesta scaduta offre «Richiedi di nuovo la firma» e mai la ripresa', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFirConFirmaInAttesa(page, true)
    test.skip(!fir, 'Nessun FIR con una richiesta di firma scaduta ancora aperta.')

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.firmaScaduta).toContainText('Non è stato firmato nulla')
    await expect(detail.firmaRichiediDiNuovo).toBeVisible()
    await expect(detail.firmaRiprendi).toBeHidden()
  })
})
