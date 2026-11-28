import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason, currentTargetIsProduction } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { attendiAbilitato } from '../../utils/attese'
import { FirDetailPage } from '../../pages/fir-detail.page'

/**
 * FIR RENTRI in viaggio, P2 — quantita' e dati di trasporto dal dettaglio del FIR, contro la fake RENTRI:
 * «Indica la quantita'» e «Indica i dati del trasporto» (i pulsanti nascono solo dalle azioni dell'ente),
 * e lo storico delle operazioni inviate.
 *
 * Premessa: un FIR legato a RENTRI ancora nella fase iniziale (l'ente propone `DatiQuantita`/`Trasporto`,
 * o le loro correzioni). Come le altre suite del ciclo di vita, la ricerca del FIR avviene via API e lo
 * scenario va in `skip` a runtime se il tenant di test non ne ha uno: mai un dato inventato. Va in `skip`
 * anche senza E2E_OPERATOR_USER/PASS. Scritture reali sull'ente: mai contro produzione.
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

/** Primo FIR legato a RENTRI per cui l'ente propone una delle `operazioni` indicate. */
async function trovaFirConAzione(
  page: import('@playwright/test').Page,
  operazioni: string[]
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
    if (azioni.some(a => operazioni.includes(a.operazione))) return fir
  }
  return null
}

test.describe('RENTRI — quantita e dati di trasporto del FIR in viaggio', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))
  test.skip(
    currentTargetIsProduction(),
    "Quantita e trasporto scrivono sull'ente: mai contro produzione."
  )

  test("«Indica la quantità»: il dialog chiede i colli o la rinfusa, poi lo storico mostra l'invio", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFirConAzione(page, ['DatiQuantita', 'DatiQuantitaUpdate'])
    test.skip(
      !fir,
      "Nessun FIR legato a RENTRI per cui l'ente proponga la quantità (fase iniziale o correzione)."
    )

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.indicaQuantita).toBeVisible()
    await detail.indicaQuantita.click()
    await expect(detail.quantitaDialog).toBeVisible()

    // Senza colli e senza rinfusa l'invio e' impossibile, non solo scoraggiato.
    await detail.quantitaColli.fill('')
    await expect(detail.quantitaConferma).toBeDisabled()

    await detail.quantitaRinfusa.click()
    await attendiAbilitato(detail.quantitaConferma)
    await detail.quantitaConferma.click()

    await expect(page.getByText('Quantità inviata a RENTRI')).toBeVisible({ timeout: 20_000 })
    await expect(detail.storicoViaggio).toContainText(/Quantità (indicata|corretta)/)
  })

  test("«Indica i dati del trasporto»: conducente e targa obbligatori, poi lo storico mostra l'invio", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const fir = await trovaFirConAzione(page, ['Trasporto', 'TrasportoUpdate'])
    test.skip(
      !fir,
      "Nessun FIR legato a RENTRI per cui l'ente proponga i dati di trasporto (fase iniziale o correzione)."
    )

    const detail = new FirDetailPage(page)
    await detail.goto(fir!.id)
    await detail.expectLoaded()

    await expect(detail.indicaTrasporto).toBeVisible()
    await detail.indicaTrasporto.click()
    await expect(detail.trasportoDialog).toBeVisible()

    await detail.trasportoNome.fill('')
    await detail.trasportoCognome.fill('')
    await detail.trasportoTarga.fill('')
    await expect(detail.trasportoConferma).toBeDisabled()

    await detail.trasportoNome.fill('Mario')
    await detail.trasportoCognome.fill('De Rossi')
    await detail.trasportoTarga.fill('AB123CD')
    await attendiAbilitato(detail.trasportoConferma)
    await detail.trasportoConferma.click()

    await expect(page.getByText('Dati di trasporto inviati a RENTRI')).toBeVisible({
      timeout: 20_000,
    })
    await expect(detail.storicoViaggio).toContainText(/Dati di trasporto (indicati|corretti)/)
  })

  test("un FIR per cui l'ente non propone quantita ne trasporto non mostra i due pulsanti", async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const bearer = { Authorization: `Bearer ${await token(page)}` }
    const lista = await page.request.get(`${getApiUrl()}/fir?limit=100`, { headers: bearer })
    const firs = ((await lista.json()).items ?? []) as FirSommario[]
    let candidato: FirSommario | null = null
    for (const fir of firs.filter(f => !!f.rentriNumeroFir)) {
      const r = await page.request.get(`${getApiUrl()}/rentri/fir/${fir.id}/azioni`, {
        headers: bearer,
      })
      if (!r.ok()) continue
      const { azioni } = (await r.json()) as { azioni: Azione[] }
      const ops = azioni.map(a => a.operazione)
      if (
        !ops.some(o =>
          ['DatiQuantita', 'DatiQuantitaUpdate', 'Trasporto', 'TrasportoUpdate'].includes(o)
        )
      ) {
        candidato = fir
        break
      }
    }
    test.skip(!candidato, 'Nessun FIR legato a RENTRI fuori dalla fase iniziale.')

    const detail = new FirDetailPage(page)
    await detail.goto(candidato!.id)
    await detail.expectLoaded()
    await expect(detail.indicaQuantita).toBeHidden()
    await expect(detail.indicaTrasporto).toBeHidden()
  })
})
