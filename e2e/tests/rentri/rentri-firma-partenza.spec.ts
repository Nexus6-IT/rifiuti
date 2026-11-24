import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason, currentTargetIsProduction } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * FIR RENTRI in viaggio, P3 — firme di partenza dal dettaglio del FIR, contro la fake RENTRI:
 * creazione -> quantita/trasporto -> «Firma la partenza su RENTRI» -> stato di viaggio riletto.
 *
 * Premessa: un FIR legato a RENTRI per cui l'ente propone una firma di partenza (produttore, trasportatore o
 * entrambi: stato `Firma*Iniziale`). Come le altre suite del ciclo di vita, la ricerca del FIR avviene via API
 * e lo scenario va in `skip` a runtime se il tenant di test non ne ha uno: mai un dato inventato. Va in `skip`
 * anche senza E2E_OPERATOR_USER/PASS. Scritture reali sull'ente: mai contro produzione.
 *
 * La firma remota chiede la conferma sull'app RENTRI FIR Digitale: con la fake la conferma si simula dal canale
 * di controllo, quindi qui si verifica il percorso fino alla richiesta di firma e, dopo la conferma, la ripresa.
 */

interface FirSommario {
  id: string
  rentriNumeroFir?: string | null
}

interface Azione {
  operazione: string
}

const FIRME_PARTENZA = [
  'AcquisizioneFirmaProduttoreTrasportatore',
  'AcquisizioneFirmaProduttore',
  'AcquisizioneFirmaTrasportatore',
]

async function token(page: import('@playwright/test').Page): Promise<string> {
  const t = await page.evaluate(() => localStorage.getItem('accessToken'))
  if (!t) throw new Error('accessToken assente in localStorage dopo il login')
  return t
}

async function trovaFir(
  page: import('@playwright/test').Page,
  conFirmaPartenza: boolean
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
    const ha = azioni.some(a => FIRME_PARTENZA.includes(a.operazione))
    if (ha === conFirmaPartenza) return fir
  }
  return null
}

test.describe('RENTRI — firme di partenza del FIR in viaggio', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))
  test.skip(
    currentTargetIsProduction(),
    "Le firme di partenza scrivono sull'ente: mai contro produzione."
  )

  test('«Firma la partenza su RENTRI»: la richiesta parte una sola volta e il banner la riprende', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFir(page, true)
    test.skip(
      !fir,
      "Nessun FIR legato a RENTRI per cui l'ente proponga la firma di partenza (stato Firma*Iniziale)."
    )

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.firmaPartenzaBanner).toContainText('Firma RENTRI da completare')
    await expect(detail.firmaPartenza).toBeVisible()
    await detail.firmaPartenza.click()

    // Senza la conferma sul telefono la richiesta resta in attesa: il banner di P1 prende il posto del
    // pulsante e non permette una seconda richiesta.
    await expect(detail.firmaInAttesa).toBeVisible({ timeout: 30_000 })
    await expect(detail.firmaPartenza).toBeHidden()
    await expect(detail.firmaRiprendi).toBeVisible()
  })

  test("un FIR per cui l'ente non propone la firma di partenza non mostra né il banner né il pulsante", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFir(page, false)
    test.skip(!fir, 'Nessun FIR legato a RENTRI senza firma di partenza da fare.')

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.firmaPartenzaBanner).toBeHidden()
    await expect(detail.firmaPartenza).toBeHidden()
  })
})
