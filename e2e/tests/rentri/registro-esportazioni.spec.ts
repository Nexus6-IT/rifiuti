import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl, getRentriFakeUrl } from '../../utils/env'
import { giornoItaliano } from '../../utils/legami-api'
import { attendiAbilitato, cliccaEAttendi } from '../../utils/attese'

/**
 * eREGI E7 — esportazione XML firmata del registro, sulla fake.
 *
 * Percorso: registro collegato -> carico DT -> «Trasmetti» (la fake tiene la transazione in
 * attesa, poi la si completa) -> «Genera esportazione» dal pannello -> validazione della fake ->
 * «Scarica XML» (file firmato) -> rettifica -> seconda esportazione che CITA la prima nella catena
 * dei digest (Reference in più nel file).
 *
 * Premesse che nessuna fixture nota può garantire (azienda con credenziale RENTRI, registro con
 * sede nota alla fake e senza annotazioni già partite): quando mancano il test fa `test.skip()` a
 * runtime con il motivo (la rettifica NON si salta: se fallisce il test fallisce). NON eseguito in
 * CI (come le altre spec di tests/rentri/, la fake non e' avviata nel job E2E). Per girarci servono
 * ANCHE: una unita' locale dell'azienda con `numIscrSito` conforme all'XSD del registro e noto alla
 * fake (le unita' di fixture `MI00001234-00x` NON lo sono: la generazione risponde 422, FEDELTA
 * §10.1) e una credenziale RENTRI dell'azienda. Il job mensile automatico NON si prova qui: e'
 * spento di predefinito e si accende solo dopo la prova sul demo RENTRI.
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

/** Numero di `Reference` XMLDSig del file: il primo punta all'eREGI, gli altri ai file precedenti. */
function contaReference(xml: string): number {
  return (xml.match(/<(?:\w+:)?Reference[\s>]/g) ?? []).length
}

test.describe('RENTRI — esportazione XML del registro (sulla fake)', () => {
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))

  test('trasmissione, esportazione firmata e validata, download, rettifica e seconda esportazione in catena', async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(240_000)
    await loginAndSaveState(page, context, 'admin')
    const auth = { Authorization: `Bearer ${await token(page)}` }
    const api = getApiUrl()
    const fake = getRentriFakeUrl()

    test.skip(!(await fakeViva(request)), 'La fake RENTRI non risponde (E2E_RENTRI_FAKE_URL).')

    // Registro con sede e credenziale; se non è ancora collegato lo si collega a un registro della fake.
    await request.post(`${api}/registro/registri/assicura`, { headers: auth })
    const lista = await request.get(`${api}/rentri/registro/registri`, { headers: auth })
    expect(lista.ok(), `GET /rentri/registro/registri ha risposto ${lista.status()}`).toBeTruthy()
    const registro = ((await lista.json()).registri as RegistroRentri[]).find(
      r => r.haCertificato && r.numIscrSito
    )
    test.skip(!registro, 'Nessun registro con sede e credenziale RENTRI in questo tenant.')
    let identificativo = registro!.identificativoRentri
    if (!identificativo) {
      const crea = await request.post(`${fake}/__controllo/registri/registro`, {
        data: { num_iscr_sito: registro!.numIscrSito, attivita: ['Produzione'] },
        failOnStatusCode: false,
      })
      test.skip(!crea.ok(), 'La sede del registro non è fra quelle note alla fake RENTRI.')
      identificativo = (await crea.json()).identificativo as string
      const collega = await request.post(
        `${api}/rentri/registro/registri/${registro!.registroId}/rentri/collega`,
        { headers: auth, data: { identificativo } }
      )
      test.skip(!collega.ok(), `Collegamento non riuscito in questo tenant (${collega.status()}).`)
    }
    // La fake deve conoscere il registro (eREGI scaricabile e registro per i movimenti).
    await request.post(`${fake}/__controllo/dati-registri/registro`, {
      data: { identificativo_registro: identificativo },
    })

    // Un carico DT (modalità manuale: nulla parte da solo).
    const crea = await request.post(`${api}/registro`, {
      headers: auth,
      data: {
        type: 'CARICO',
        movementDate: giornoItaliano(),
        causale: 'DT',
        cerCode: '20 03 01',
        quantity: 10,
        registroId: registro!.registroId,
      },
    })
    test.skip(!crea.ok(), `Carico DT non registrabile in questo tenant (${crea.status()}).`)
    const movimentoId = (await crea.json()).id as string

    // 1. Trasmissione dalla UI; la fake conferma dal canale di controllo.
    await page.goto('/registro')
    const sel = page.getByTestId(`registro-rentri-sel-${movimentoId}`)
    await expect(sel).toBeVisible({ timeout: 15_000 })
    await sel.click()
    await page.getByTestId('rentri-trasmetti').click()
    await page.getByTestId('rentri-conferma-si').click()
    await expect
      .poll(
        async () => {
          const r = await request.get(
            `${fake}/__controllo/dati-registri/ultima-transazione/${identificativo}`,
            { failOnStatusCode: false }
          )
          return r.ok() ? ((await r.json()).transazione_id as string) : null
        },
        { timeout: 30_000, message: 'La fake non ha ricevuto alcuna transazione Movimenti' }
      )
      .not.toBeNull()
    const ultima = await request.get(
      `${fake}/__controllo/dati-registri/ultima-transazione/${identificativo}`
    )
    const completa = await request.post(`${fake}/__controllo/dati-registri/completa-transazione`, {
      data: {
        transazione_id: (await ultima.json()).transazione_id,
        errore: false,
        validazione: [],
      },
    })
    expect(completa.ok()).toBeTruthy()
    const verifica = page.getByTestId(`rentri-verifica-${movimentoId}`)
    if (await verifica.isVisible().catch(() => false)) await verifica.click()
    await expect(page.getByTestId(`rentri-stato-${movimentoId}`)).toHaveText(/Trasmessa/, {
      timeout: 90_000,
    })

    // 2. Esportazione dal pannello. Se il tenant ne ha già (run precedenti) ci si limita ad
    // aggiungere: il confronto è sul NUMERO di righe prima e dopo.
    await page.reload()
    const sezione = page.getByTestId('rentri-esp')
    await expect(sezione).toBeVisible({ timeout: 15_000 })
    const righe = sezione.locator('[data-testid^="rentri-esp-riga-"]')
    const prima = await righe.count()
    const genera = page.getByTestId('rentri-esp-genera')
    await attendiAbilitato(genera)
    await cliccaEAttendi(page, genera.locator('button'), {
      metodo: 'POST',
      percorso: /\/esportazioni$/,
      stato: [200, 201],
    })
    await expect(righe).toHaveCount(prima + 1, { timeout: 30_000 })
    const nuova = righe.first()
    const idPrima = (await nuova.getAttribute('data-testid'))!.replace('rentri-esp-riga-', '')

    // 3. Validazione: la fake risponde; se l'esito non è ancora arrivato si riprova dalla UI.
    const stato = page.getByTestId(`rentri-esp-stato-${idPrima}`)
    await expect
      .poll(
        async () => {
          const testo = (await stato.textContent())?.trim() ?? ''
          if (/Validata/.test(testo) || /Rifiutata/.test(testo)) return testo
          const rivalida = page.getByTestId(`rentri-esp-rivalida-${idPrima}`)
          if (await rivalida.isVisible().catch(() => false)) {
            await rivalida.locator('button').click()
          }
          return testo
        },
        { timeout: 60_000, message: 'La validazione della fake non è arrivata a un esito' }
      )
      .toMatch(/Validata/)
    await expect(stato).not.toContainText('Rifiutata')

    // 4. Download del file firmato.
    const [scarico] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`rentri-esp-scarica-${idPrima}`).locator('button').click(),
    ])
    expect(scarico.suggestedFilename()).toMatch(/\.SignedR\.xml$/)
    const percorso = await scarico.path()
    const xmlPrima = (await import('node:fs')).readFileSync(percorso!, 'utf8')
    expect(xmlPrima).toContain('Signature')
    const referencePrima = contaReference(xmlPrima)
    expect(referencePrima).toBeGreaterThanOrEqual(1)

    // 5. Rettifica (nuova annotazione) -> seconda esportazione che cita la prima.
    const rett = await request.post(`${api}/registro/movimenti/${movimentoId}/rettifica`, {
      headers: auth,
      data: {
        motivo: 'Quantità errata in fase di registrazione',
        movementDate: giornoItaliano(),
        causale: 'DT',
        cerCode: '20 03 01',
        quantity: 12,
        unit: 'KG',
      },
    })
    expect(
      rett.ok(),
      `Rettifica non riuscita (${rett.status()}): ${await rett.text()}`
    ).toBeTruthy()

    await page.reload()
    await expect(sezione).toBeVisible({ timeout: 15_000 })
    const primaDelSecondo = await righe.count()
    await attendiAbilitato(page.getByTestId('rentri-esp-genera'))
    await cliccaEAttendi(page, page.getByTestId('rentri-esp-genera').locator('button'), {
      metodo: 'POST',
      percorso: /\/esportazioni$/,
      stato: [200, 201],
    })
    await expect(righe).toHaveCount(primaDelSecondo + 1, { timeout: 30_000 })
    const idSecondo = (await righe.first().getAttribute('data-testid'))!.replace(
      'rentri-esp-riga-',
      ''
    )
    expect(idSecondo).not.toBe(idPrima)

    const [scarico2] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`rentri-esp-scarica-${idSecondo}`).locator('button').click(),
    ])
    const xmlSecondo = (await import('node:fs')).readFileSync((await scarico2.path())!, 'utf8')
    // Catena: il secondo file ha almeno una Reference in più (il digest del precedente).
    expect(contaReference(xmlSecondo)).toBeGreaterThan(referencePrima)
  })
})
