import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason, currentTargetIsProduction } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * FIR RENTRI in viaggio, P5 — sosta tecnica dal dettaglio del FIR, contro la fake RENTRI, COME TRASPORTATORE:
 * «Dichiara una sosta tecnica» -> luogo, sospensione, ripresa -> invio -> richiesta di firma sul telefono
 * (una sola) -> banner di ripresa.
 *
 * Premessa: un FIR legato a RENTRI in viaggio per cui l'ente propone `SostaTecnica` e il cui trasportatore e'
 * l'azienda dell'utente di test (la sosta la dichiara solo il trasportatore che ha in carico il rifiuto: se
 * l'azienda non lo e' il backend risponde 409 e lo scenario va in `skip`). Come le altre suite del ciclo di
 * vita, la ricerca del FIR avviene via API e lo scenario va in `skip` a runtime se non ce n'e' uno: mai un dato
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
  conSosta: boolean
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
    const ha = azioni.some(a => a.operazione === 'SostaTecnica')
    if (ha === conSosta) return fir
  }
  return null
}

test.describe('RENTRI — sosta tecnica del FIR in viaggio (come trasportatore)', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))
  test.skip(
    currentTargetIsProduction(),
    'La sosta tecnica scrive sull’ente: mai contro produzione.'
  )

  test('«Dichiara una sosta tecnica»: i dati partono, la firma si chiede una sola volta e il banner la riprende', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFir(page, true)
    test.skip(
      !fir,
      "Nessun FIR legato a RENTRI in viaggio per cui l'ente proponga la sosta tecnica."
    )

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.dichiaraSostaTecnica).toBeVisible()
    await detail.dichiaraSostaTecnica.click()
    await expect(detail.sostaDialog).toBeVisible()

    // Vuoto o di soli spazi, e date incomplete o invertite: l'invio resta disabilitato.
    await expect(detail.sostaConferma).toBeDisabled()
    await detail.sostaLuogo.fill('   ')
    await detail.sostaSospensione.fill('2026-11-18T10:00')
    await detail.sostaRipresa.fill('2026-11-18T12:30')
    await expect(detail.sostaConferma).toBeDisabled()

    await detail.sostaLuogo.fill('Area di servizio A1 km 120')
    await expect(detail.sostaContatore).toContainText('/ 1000')
    await expect(detail.sostaConferma).toBeEnabled()

    await detail.sostaRipresa.fill('2026-11-18T09:00')
    await expect(detail.sostaDateErrore).toContainText('successiva')
    await expect(detail.sostaConferma).toBeDisabled()

    await detail.sostaRipresa.fill('2026-11-18T12:30')
    await expect(detail.sostaConferma).toBeEnabled()
    await detail.sostaConferma.click()

    // L'azienda dell'utente potrebbe non essere il trasportatore del FIR: in quel caso l'invio non parte e il
    // dialog lo dice. Non e' un difetto: lo scenario non e' applicabile a questo FIR.
    const esito = await Promise.race([
      detail.firmaInAttesa.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'firma'),
      detail.sostaErrore.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'errore'),
    ])
    if (esito === 'errore') {
      const messaggio = (await detail.sostaErrore.textContent()) ?? ''
      test.skip(
        /trasportator/i.test(messaggio),
        `L'azienda di test non e' il trasportatore di questo FIR: ${messaggio}`
      )
      throw new Error(`Invio della sosta tecnica rifiutato: ${messaggio}`)
    }

    // Senza la conferma sul telefono la richiesta resta in attesa: il banner di P1 prende il posto del
    // pulsante e non permette una seconda sosta ne' una seconda richiesta di firma.
    await expect(detail.dichiaraSostaTecnica).toBeHidden()
    await expect(detail.firmaRiprendi).toBeVisible()
  })

  test("un FIR per cui l'ente non propone la sosta tecnica non mostra il pulsante", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFir(page, false)
    test.skip(!fir, 'Nessun FIR legato a RENTRI senza sosta tecnica disponibile.')

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.dichiaraSostaTecnica).toBeHidden()
  })
})
