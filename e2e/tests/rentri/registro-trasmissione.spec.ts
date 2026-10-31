import { test, expect, type Page } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl, getRentriFakeUrl } from '../../utils/env'

/**
 * F2-9 — trasmissione del registro carico/scarico a RENTRI, sulla fake.
 *
 * Percorso: registro -> identificativo (amministratore) -> carico con causale DT ->
 * "Trasmetti" -> la fake tiene la transazione in attesa (NONBLOCK_PULL) -> la si completa dal
 * canale di controllo -> "Verifica" -> tag "Trasmessa" e checkbox della riga disabilitata.
 *
 * Premesse che nessuna fixture nota può garantire in anticipo (azienda con una credenziale RENTRI
 * configurata sulla fake, registro senza annotazioni già partite): quando mancano il test fa
 * `test.skip()` a runtime con il motivo, mai un test vuoto che passa in silenzio.
 * Non gira contro produzione: la fake è raggiunta solo da E2E_RENTRI_FAKE_URL (default locale).
 */

interface RegistroRentri {
  registroId: string
  identificativoRentri: string | null
  haCertificato: boolean
}

async function token(page: Page): Promise<string> {
  const t = await page.evaluate(() => localStorage.getItem('accessToken'))
  if (!t) throw new Error('accessToken assente in localStorage dopo il login')
  return t
}

/** Identificativo di registro nel formato RENTRI `R` + 10 caratteri maiuscoli/cifre. */
function identificativoCasuale(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  let s = 'R'
  for (let i = 0; i < 10; i++) s += alfabeto[Math.floor(Math.random() * alfabeto.length)]
  return s
}

test.describe('RENTRI — trasmissione del registro (sulla fake)', () => {
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))

  test('un carico DT viene trasmesso e passa a "Trasmessa" solo dopo la conferma della fake', async ({
    page,
    context,
    request,
  }) => {
    await loginAndSaveState(page, context, 'admin')
    const auth = { Authorization: `Bearer ${await token(page)}` }
    const api = getApiUrl()

    const fakeViva = await request
      .get(`${getRentriFakeUrl()}/__salute`, { failOnStatusCode: false })
      .then(r => r.ok())
      .catch(() => false)
    test.skip(
      !fakeViva,
      'La fake RENTRI non risponde: avviare tools/rentri-fake (E2E_RENTRI_FAKE_URL).'
    )

    // Il registro dell'azienda (uno per sede) e le sue impostazioni di trasmissione.
    await request.post(`${api}/registro/registri/assicura`, { headers: auth })
    const lista = await request.get(`${api}/rentri/registro/registri`, { headers: auth })
    expect(lista.ok(), `GET /rentri/registro/registri ha risposto ${lista.status()}`).toBeTruthy()
    const registri = (await lista.json()).registri as RegistroRentri[]
    const registro = registri[0]
    test.skip(!registro, 'Nessun registro per questa azienda.')
    test.skip(
      !registro.haCertificato,
      "L'azienda di test non ha una credenziale RENTRI: senza non c'è invio da provare."
    )

    // Identificativo: registrato sulla fake e impostato (solo se non ci sono annotazioni già partite).
    const identificativo = registro.identificativoRentri ?? identificativoCasuale()
    await request.post(`${getRentriFakeUrl()}/__controllo/dati-registri/registro`, {
      data: { identificativo_registro: identificativo },
    })
    if (!registro.identificativoRentri) {
      const imposta = await request.put(`${api}/rentri/registro/registri/${registro.registroId}`, {
        headers: auth,
        data: { identificativoRentri: identificativo },
      })
      test.skip(
        imposta.status() === 409,
        'Il registro ha già annotazioni trasmesse: identificativo non modificabile in questo tenant.'
      )
      expect(imposta.ok(), `PUT identificativo ha risposto ${imposta.status()}`).toBeTruthy()
    }

    // Un carico con causale DT (modalità manuale: nulla parte da solo).
    const oggi = new Date().toISOString().slice(0, 10)
    const crea = await request.post(`${api}/registro`, {
      headers: auth,
      data: {
        type: 'CARICO',
        movementDate: oggi,
        causale: 'DT',
        cerCode: '20 03 01',
        quantity: 10,
        registroId: registro.registroId,
      },
    })
    test.skip(
      !crea.ok(),
      `Carico DT non registrabile in questo tenant (${crea.status()}): servono sede e dati di partenza.`
    )
    const movimentoId = (await crea.json()).id as string

    // UI: selezione della riga e "Trasmetti".
    await page.goto('/registro')
    const checkbox = page.getByTestId(`registro-rentri-sel-${movimentoId}`)
    await expect(checkbox).toBeVisible({ timeout: 15_000 })
    await checkbox.click()
    await page.getByTestId('rentri-trasmetti').click()
    await page.getByTestId('rentri-conferma-si').click()

    // L'invio è accettato ma NON confermato: la fake tiene la transazione in attesa.
    await expect
      .poll(
        async () => {
          const r = await request.get(
            `${getRentriFakeUrl()}/__controllo/dati-registri/ultima-transazione/${identificativo}`,
            { failOnStatusCode: false }
          )
          return r.ok() ? ((await r.json()).transazione_id as string) : null
        },
        { timeout: 30_000, message: 'La fake non ha ricevuto alcuna transazione Movimenti' }
      )
      .not.toBeNull()
    const r = await request.get(
      `${getRentriFakeUrl()}/__controllo/dati-registri/ultima-transazione/${identificativo}`
    )
    const transazioneId = (await r.json()).transazione_id as string

    await expect(page.getByTestId(`rentri-stato-${movimentoId}`)).not.toHaveText(
      /^\s*Trasmessa\s*$/
    )

    // La fake conferma; "Verifica" rilegge l'esito e il tag diventa "Trasmessa".
    const completa = await request.post(
      `${getRentriFakeUrl()}/__controllo/dati-registri/completa-transazione`,
      { data: { transazione_id: transazioneId, errore: false, validazione: [] } }
    )
    expect(completa.ok()).toBeTruthy()

    const verifica = page.getByTestId(`rentri-verifica-${movimentoId}`)
    if (await verifica.isVisible().catch(() => false)) await verifica.click()
    await expect(page.getByTestId(`rentri-stato-${movimentoId}`)).toHaveText(/Trasmessa/, {
      timeout: 90_000,
    })

    // Una annotazione confermata non si ritrasmette: la checkbox è disabilitata.
    await page.reload()
    await expect(page.getByTestId(`registro-rentri-sel-${movimentoId}`)).toBeDisabled()
  })
})
