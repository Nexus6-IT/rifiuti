import { test, expect, devices, type Page, type Route } from '@playwright/test'

/**
 * E2E - App campo P2 (PWA autisti) su viewport telefono.
 *
 * L'API e' simulata con `page.route`: l'app campo e' una SPA servita sotto `/campo/` dal container
 * frontend, e qui si prova la SPA (login, ritorno SPID, giro, dettaglio, uscita, sessione superata,
 * manifest e service worker), non il backend (coperto da `autisti-giro.spec.ts` e dai test del
 * controller). Serve solo il frontend che serve `/campo/` (baseURL), nessun database.
 *
 * Il login SPID/CIE reale non e' automatizzabile: il test verifica che il link parta con
 * `RelayState=campo` e simula la risposta del backend (302 verso `/campo/accesso#token`).
 */
const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = devices['Pixel 7']
// Il service worker intercetterebbe le richieste dopo la prima pagina, sfuggendo a `page.route`:
// si blocca ovunque tranne che nella prova del worker stesso (in fondo).
test.use({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, serviceWorkers: 'block' })

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

const SESSIONE = JSON.stringify({ accessToken: 'tok-a', refreshToken: 'tok-r' })

async function conSessione(page: Page) {
  await page.addInitScript(
    ([k, v]) => {
      if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    },
    ['wasteflow.campo.sessione', SESSIONE]
  )
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

test.describe('App campo P2: PWA su telefono', () => {
  test('senza sessione la radice porta al login; il link SPID/CIE porta il canale campo', async ({
    page,
  }) => {
    await page.goto('/campo/')
    await expect(page).toHaveURL(/\/campo\/login$/)
    const accedi = page.getByTestId('accedi')
    await expect(accedi).toBeVisible()
    // RelayState `campo.<nonce>`: il nonce anti login-CSRF e' generato dal browser a ogni apertura.
    await expect(accedi).toHaveAttribute(
      'href',
      /^\/api\/v1\/auth\/spid\/login\?RelayState=campo\.[A-Za-z0-9_-]{22}$/
    )
    // Bersaglio toccabile da dito: almeno 44 px.
    expect((await accedi.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  })

  test('il ritorno SPID salva i token, toglie il fragment e mostra il giro', async ({ page }) => {
    let richiestaLogin = ''
    await page.route('**/api/v1/auth/spid/login**', route => {
      richiestaLogin = route.request().url()
      // Come il backend: il nonce del RelayState torna nel fragment.
      const nonce = new URL(richiestaLogin).searchParams.get('RelayState')?.split('.')[1] ?? ''
      return route.fulfill({
        status: 302,
        headers: {
          location: `/campo/accesso#accessToken=tok-a&refreshToken=tok-r&expiresIn=900&nonce=${nonce}`,
        },
      })
    })
    await page.route('**/api/v1/campo/giro**', route => json(route, GIRO))

    await page.goto('/campo/login')
    await page.getByTestId('accedi').click()

    await expect(page.getByTestId('elenco')).toBeVisible()
    expect(richiestaLogin).toContain('RelayState=campo.')
    await expect(page).toHaveURL(/\/campo\/$/)
    expect(page.url()).not.toContain('accessToken')
    await expect(page.getByTestId('ritiro')).toHaveCount(2)
    await expect(page.getByTestId('ritiro').first()).toContainText('Rossi Srl')
  })

  test('un link con i token e un nonce che il browser non ha generato non apre nessuna sessione', async ({
    page,
  }) => {
    await page.route('**/api/v1/campo/giro**', route => json(route, GIRO))
    // Nessun passaggio dal login: il nonce non c'e'. Poi un nonce sbagliato dopo un login iniziato.
    await page.goto(
      '/campo/accesso#accessToken=altrui&refreshToken=altrui&nonce=AAAAAAAAAAAAAAAAAAAAAA'
    )
    await expect(page).toHaveURL(/\/campo\/login$/)
    expect(await page.evaluate(() => localStorage.getItem('wasteflow.campo.sessione'))).toBeNull()
    await page.goto('/campo/accesso#accessToken=altrui&refreshToken=altrui')
    await expect(page).toHaveURL(/\/campo\/login$/)
    expect(await page.evaluate(() => localStorage.getItem('wasteflow.campo.sessione'))).toBeNull()
  })

  test('giro, dettaglio, ritorno e uscita; niente scroll orizzontale', async ({ page }) => {
    await conSessione(page)
    const autorizzazioni: Array<string | undefined> = []
    await page.route('**/api/v1/campo/giro**', route => {
      autorizzazioni.push(route.request().headers()['authorization'])
      return json(route, GIRO)
    })
    let logout = false
    await page.route('**/api/v1/auth/logout', route => {
      logout = true
      return json(route, { message: 'ok' })
    })

    await page.goto('/campo/')
    await expect(page.getByTestId('elenco')).toBeVisible()
    const larghezze = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ])
    expect(larghezze[0]).toBeLessThanOrEqual(larghezze[1])

    await page.getByTestId('ritiro').nth(1).click()
    await expect(page).toHaveURL(/\/campo\/ritiro\/r2$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Verdi Spa')
    await expect(page.getByTestId('dettaglio')).toContainText('Via Roma 2, Bari')
    await expect(page.getByTestId('dettaglio')).toContainText('120 kg')

    await page.getByTestId('indietro').click()
    await expect(page.getByTestId('elenco')).toBeVisible()
    expect(autorizzazioni.length).toBeGreaterThanOrEqual(1)
    expect(new Set(autorizzazioni)).toEqual(new Set(['Bearer tok-a']))

    await page.getByTestId('esci').click()
    await expect(page).toHaveURL(/\/campo\/login$/)
    expect(logout).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('wasteflow.campo.sessione'))).toBeNull()
  })

  test('apertura diretta di un ritiro (deep link): fallback SPA di campo e giro ricaricato', async ({
    page,
  }) => {
    await conSessione(page)
    await page.route('**/api/v1/campo/giro**', route => json(route, GIRO))
    await page.goto('/campo/ritiro/r1')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rossi Srl')
  })

  test('giro vuoto e errore del giro con possibilita di riprovare', async ({ page }) => {
    await conSessione(page)
    let n = 0
    await page.route('**/api/v1/campo/giro**', route => {
      n++
      return n === 1
        ? json(route, { message: 'Nessun autista collegato.' }, 403)
        : json(route, { ...GIRO, ritiri: [] })
    })
    await page.goto('/campo/')
    await expect(page.getByTestId('errore')).toContainText('Nessun autista collegato.')
    await page.getByRole('button', { name: 'Riprova' }).click()
    await expect(page.getByTestId('vuoto')).toBeVisible()
  })

  test('sessione superata da un altro accesso (401 anche dopo il rinnovo): torna al login', async ({
    page,
  }) => {
    await conSessione(page)
    await page.route('**/api/v1/campo/giro**', route => json(route, { message: 'x' }, 401))
    await page.route('**/api/v1/auth/refresh', route =>
      json(route, { accessToken: 'tok-b', expiresIn: 900 })
    )
    await page.goto('/campo/')
    await expect(page).toHaveURL(/\/campo\/login$/)
    expect(await page.evaluate(() => localStorage.getItem('wasteflow.campo.sessione'))).toBeNull()
  })
})

test.describe('App campo P2: manifest e service worker', () => {
  test.use({ serviceWorkers: 'allow' })

  test('manifest installabile e shell del service worker senza dati dell API', async ({
    page,
    request,
  }) => {
    // Il worker si registra a app stabile (fino a 30 s): tempo in piu' rispetto al default.
    test.setTimeout(90_000)
    const manifest = await (await request.get('/campo/manifest.webmanifest')).json()
    expect(manifest.start_url).toBe('/campo/')
    expect(manifest.scope).toBe('/campo/')
    expect(manifest.display).toBe('standalone')
    const dimensioni = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(dimensioni).toEqual(expect.arrayContaining(['192x192', '512x512']))
    for (const icona of manifest.icons) {
      expect((await request.get(`/campo/${icona.src}`)).ok(), icona.src).toBe(true)
    }

    // ngsw.json: solo asset della shell, nessun dataGroup (nessuna risposta API in cache).
    const ngsw = await (await request.get('/campo/ngsw.json')).json()
    expect(ngsw.dataGroups ?? []).toEqual([])
    expect(JSON.stringify(ngsw.assetGroups)).not.toContain('/api/')

    await conSessione(page)
    await page.route('**/api/v1/campo/giro**', route => json(route, GIRO))
    await page.goto('/campo/')
    await expect(page.getByTestId('elenco')).toBeVisible()
    const attivo = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return reg.active?.scriptURL ?? null
    })
    expect(attivo).toContain('/campo/ngsw-worker.js')

    const inCache = await page.evaluate(async () => {
      const urls: string[] = []
      for (const nome of await caches.keys()) {
        for (const r of await (await caches.open(nome)).keys()) urls.push(r.url)
      }
      return urls
    })
    expect(inCache.filter(u => u.includes('/api/'))).toEqual([])
  })
})
