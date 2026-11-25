import { test, expect, devices, type Page, type Route } from '@playwright/test'
import { pushNonDisponibile } from '../../utils/campo-push'

/**
 * E2E - App campo P3 (giro offline) su viewport telefono, rete spenta con `context.setOffline`.
 *
 * Il service worker deve essere ATTIVO (senza, la shell non si ricarica offline), quindi qui
 * `serviceWorkers: 'allow'` e l'API simulata con `context.route`. I dati del giro stanno solo in
 * IndexedDB gestito dall'app: il service worker serve la shell e basta.
 */
const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = devices['Pixel 7']
test.use({
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
  serviceWorkers: 'allow',
  timezoneId: 'Europe/Rome',
})

const OGGI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())

const ritiro = (id: string, nome: string, ordine: number) => ({
  id,
  dataPrevista: OGGI,
  fascia: ordine === 1 ? 'MATTINA' : 'POMERIGGIO',
  ordineGiro: ordine,
  produttore: { id: `p${ordine}`, nome, sedeId: 's', indirizzo: `Via Roma ${ordine}, Bari` },
  trasportatore: { id: 't', nome: 'Trasporti Sud' },
  destinatario: { id: 'd', nome: 'Impianto Nord', sedeId: 'sd' },
  automezzo: { id: 'a', targa: 'AB123CD' },
  autista: { id: 'au', nome: 'Luca' },
  cerCode: '150102',
  descrizione: 'Imballaggi in plastica',
  quantitaPresunta: '120',
  unita: 'kg',
  stato: 'PROGRAMMATO',
  statoVisibile: 'DA_GENERARE',
  motivo: null,
  fir: null,
  serieId: null,
  versione: 1,
})

const GIRO = {
  data: OGGI,
  autista: { id: 'au', nome: 'Luca', cognome: 'Bianchi' },
  ritiri: [ritiro('r1', 'Rossi Srl', 1), ritiro('r2', 'Verdi Spa', 2)],
}

/** Access token finto con solo il `sub` (l'app lo legge senza verificarlo). */
const sessione = (utente: string) =>
  JSON.stringify({
    accessToken: `h.${Buffer.from(JSON.stringify({ sub: utente })).toString('base64url')}.s`,
    refreshToken: 'tok-r',
  })

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/**
 * `context.route` risponde anche a rete spenta (le route precedono lo stack di rete): lo si
 * allinea a `setOffline` con un interruttore, cosi la richiesta cade come in aereo.
 */
const rete = { spenta: false }
async function reteSpenta(page: Page, spenta: boolean) {
  rete.spenta = spenta
  await page.context().setOffline(spenta)
}

async function avvia(page: Page, utente: string) {
  rete.spenta = false
  await page.addInitScript(
    ([k, v]) => {
      if (!sessionStorage.getItem('inizializzato')) {
        sessionStorage.setItem('inizializzato', '1')
        localStorage.setItem(k, v)
      }
    },
    ['wasteflow.campo.sessione', sessione(utente)]
  )
  await page
    .context()
    .route('**/api/v1/campo/giro**', route =>
      rete.spenta ? route.abort('internetdisconnected') : json(route, GIRO)
    )
  await page.context().route('**/api/v1/auth/logout', route => json(route, { message: 'ok' }))
  await page.goto('/campo/')
  await expect(page.getByTestId('elenco')).toBeVisible()
  // Worker attivo e shell in cache: serve un ricaricamento perche' controlli la pagina.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(page.getByTestId('elenco')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 })
    .toBe(true)
}

const snapshotInIdb = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ utenteId: string; data: string } | null>(risolvi => {
        const rich = indexedDB.open('wasteflow-campo', 1)
        rich.onerror = () => risolvi(null)
        rich.onsuccess = () => {
          const db = rich.result
          if (!db.objectStoreNames.contains('giro')) return risolvi(null)
          const g = db.transaction('giro', 'readonly').objectStore('giro').get('corrente')
          g.onsuccess = () => risolvi(g.result ?? null)
          g.onerror = () => risolvi(null)
        }
      })
  )

test.beforeEach(async ({ page }) => {
  await pushNonDisponibile(page)
})

test.describe('App campo P3: giro offline', () => {
  test.setTimeout(120_000)

  test('aereo attivato: il giro e il dettaglio restano consultabili e si vede che e offline', async ({
    page,
  }) => {
    await avvia(page, 'u1')
    await expect(page.getByTestId('aggiornato')).toContainText('Aggiornato il')
    await expect(page.getByTestId('offline')).toHaveCount(0)
    const snap = await snapshotInIdb(page)
    expect(snap).toMatchObject({ utenteId: 'u1', data: OGGI })

    await reteSpenta(page, true)
    await page.reload()

    await expect(page.getByTestId('elenco')).toBeVisible()
    await expect(page.getByTestId('ritiro')).toHaveCount(2)
    await expect(page.getByTestId('ritiro').first()).toContainText('Rossi Srl')
    await expect(page.getByTestId('offline')).toBeVisible()
    await expect(page.getByTestId('offline')).toContainText('Offline')
    await expect(page.getByTestId('aggiornato')).toContainText('Aggiornato il')
    expect((await page.getByTestId('offline').boundingBox())?.width).toBeGreaterThan(200)

    await page.getByTestId('ritiro').nth(1).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Verdi Spa')
    await expect(page.getByTestId('dettaglio')).toContainText('Via Roma 2, Bari')
    await expect(page.getByTestId('offline')).toBeVisible()

    // Il service worker non ha tenuto nessuna risposta dell'API: i dati stanno solo in IndexedDB.
    const inCache = await page.evaluate(async () => {
      const urls: string[] = []
      for (const nome of await caches.keys()) {
        for (const r of await (await caches.open(nome)).keys()) urls.push(r.url)
      }
      return urls
    })
    expect(inCache.filter(u => u.includes('/api/'))).toEqual([])

    // Tornata la rete, «Aggiorna» riporta i dati freschi e toglie il banner.
    await reteSpenta(page, false)
    await page.getByTestId('indietro').click()
    await page.getByRole('button', { name: 'Aggiorna' }).click()
    await expect(page.getByTestId('offline')).toHaveCount(0)
  })

  test('telefono condiviso: un altro autista offline non vede il giro del precedente', async ({
    page,
  }) => {
    await avvia(page, 'u1')
    expect(await snapshotInIdb(page)).toMatchObject({ utenteId: 'u1' })

    // Cambio utente (altro token nello stesso telefono), poi rete spenta.
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      ['wasteflow.campo.sessione', sessione('u2')]
    )
    await reteSpenta(page, true)
    await page.reload()

    await expect(page.getByTestId('errore')).toContainText('Nessuna connessione')
    await expect(page.getByTestId('elenco')).toHaveCount(0)
    await expect(page.getByText('Rossi Srl')).toHaveCount(0)
    await expect.poll(() => snapshotInIdb(page)).toBeNull()
  })

  test('uscita: la copia del giro viene cancellata dal telefono', async ({ page }) => {
    await avvia(page, 'u1')
    expect(await snapshotInIdb(page)).not.toBeNull()
    await page.getByTestId('esci').click()
    await expect(page).toHaveURL(/\/campo\/login$/)
    await expect.poll(() => snapshotInIdb(page)).toBeNull()
  })
})
