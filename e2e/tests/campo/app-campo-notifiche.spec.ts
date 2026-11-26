import { test, expect, devices, type Page, type Route } from '@playwright/test'
import { createECDH } from 'node:crypto'

/**
 * E2E - App campo P7 (notifiche push) su viewport telefono.
 *
 * Il permesso notifiche e' quello VERO del browser (`grantPermissions`, oppure negato). Il service
 * worker e' bloccato nei test (come negli altri spec di campo) e non puo' ricevere un push vero:
 * `navigator.serviceWorker.ready` e' sostituito da una registrazione finta con un `pushManager`
 * che tiene una sottoscrizione in memoria. Il server e' simulato con `context.route`. Cosi' si
 * provano la schermata, il permesso, le chiamate (endpoint, preferenze) e la rimozione al logout
 * PRIMA del logout; la consegna vera di un push (Android, iPhone installato) resta una prova a mano.
 */
const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = devices['Pixel 7']
// `channel: 'chromium'` = Chromium con il nuovo headless: la variante «headless shell» predefinita non
// onora `grantPermissions` per le notifiche (Notification.permission resta «denied»).
test.use({
  channel: 'chromium',
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
  serviceWorkers: 'block',
  timezoneId: 'Europe/Rome',
})

const OGGI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
const GIRO = { data: OGGI, autista: { id: 'au', nome: 'Luca', cognome: 'Bianchi' }, ritiri: [] }
const sessione = (utente: string) =>
  JSON.stringify({
    accessToken: `h.${Buffer.from(JSON.stringify({ sub: utente })).toString('base64url')}.s`,
    refreshToken: 'tok-r',
  })
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

function chiaveVapidDiProva(): string {
  const e = createECDH('prime256v1')
  e.generateKeys()
  return e.getPublicKey().toString('base64url')
}

interface Server {
  disponibile: boolean
  chiave: string
  preferenze: { giroModificato: boolean }
  /** Ordine delle chiamate che contano, per provare «annulla PRIMA del logout». */
  log: string[]
  endpointRegistrati: Set<string>
  rifiutaSottoscrizione: boolean
}

function nuovoServer(): Server {
  return {
    disponibile: true,
    chiave: chiaveVapidDiProva(),
    preferenze: { giroModificato: true },
    log: [],
    endpointRegistrati: new Set(),
    rifiutaSottoscrizione: false,
  }
}

async function preparaApi(page: Page, server: Server) {
  const ctx = page.context()
  await ctx.route('**/api/v1/campo/giro**', route => json(route, GIRO))
  await ctx.route('**/api/v1/push/configurazione', route =>
    json(route, {
      disponibile: server.disponibile,
      chiavePubblica: server.disponibile ? server.chiave : null,
    })
  )
  await ctx.route('**/api/v1/push/preferenze', route => {
    if (route.request().method() === 'PUT') {
      server.preferenze = route.request().postDataJSON()
      server.log.push(`preferenze:${server.preferenze.giroModificato}`)
    }
    return json(route, server.preferenze)
  })
  await ctx.route('**/api/v1/push/sottoscrizione', route => {
    if (server.rifiutaSottoscrizione) return json(route, { error: 'PUSH_NON_DISPONIBILE' }, 503)
    const { endpoint } = route.request().postDataJSON()
    server.endpointRegistrati.add(endpoint)
    server.log.push('sottoscrizione')
    return route.fulfill({ status: 204 })
  })
  await ctx.route('**/api/v1/push/sottoscrizione/annulla', route => {
    const { endpoint } = route.request().postDataJSON()
    server.endpointRegistrati.delete(endpoint)
    server.log.push('annulla')
    return route.fulfill({ status: 204 })
  })
  await ctx.route('**/api/v1/auth/logout', route => {
    server.log.push('logout')
    return json(route, { message: 'ok' })
  })
}

/** Registrazione finta del service worker con un pushManager in memoria (stato in `window.__push`). */
async function installaPushFinto(page: Page) {
  await page.addInitScript(() => {
    const stato = {
      endpoint: null as string | null,
      chiaveInput: 0,
      sottoscritti: 0,
      annullate: 0,
    }
    ;(window as unknown as { __push: typeof stato }).__push = stato
    const registrazione = {
      pushManager: {
        getSubscription: async () =>
          stato.endpoint
            ? {
                endpoint: stato.endpoint,
                unsubscribe: async () => {
                  stato.annullate++
                  stato.endpoint = null
                  return true
                },
              }
            : null,
        subscribe: async (opzioni: {
          userVisibleOnly: boolean
          applicationServerKey: Uint8Array
        }) => {
          stato.chiaveInput = opzioni.applicationServerKey.length
          stato.sottoscritti++
          stato.endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${stato.sottoscritti}`
          return {
            endpoint: stato.endpoint,
            unsubscribe: async () => {
              stato.annullate++
              stato.endpoint = null
              return true
            },
          }
        },
      },
    }
    Object.defineProperty(navigator.serviceWorker, 'ready', {
      get: () => Promise.resolve(registrazione),
      configurable: true,
    })
  })
}

const statoFinto = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __push: {
            endpoint: string | null
            chiaveInput: number
            sottoscritti: number
            annullate: number
          }
        }
      ).__push
  )

async function entra(page: Page, utente = 'u1') {
  await page.addInitScript(
    ([k, v]) => {
      if (!sessionStorage.getItem('inizializzato')) {
        sessionStorage.setItem('inizializzato', '1')
        localStorage.setItem(k, v)
      }
    },
    ['wasteflow.campo.sessione', sessione(utente)]
  )
  await page.goto('/campo/')
  await expect(page.getByTestId('vuoto')).toBeVisible()
}

test.describe('App campo P7: notifiche push', () => {
  test('con il permesso: attiva, salva la preferenza, e al logout toglie il dispositivo PRIMA del logout', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications'])
    const server = nuovoServer()
    await preparaApi(page, server)
    await installaPushFinto(page)
    await entra(page)

    await expect(page.getByTestId('notifiche-attiva')).toContainText('non contiene dati')
    await page.getByTestId('attiva-notifiche').click()
    await expect(page.getByTestId('notifiche-attive')).toBeVisible()
    const dopoAttiva = await statoFinto(page)
    expect(dopoAttiva.sottoscritti).toBe(1)
    expect(dopoAttiva.chiaveInput).toBe(65) // chiave VAPID pubblica non compressa
    expect([...server.endpointRegistrati]).toEqual([dopoAttiva.endpoint])

    await page.getByTestId('pref-giro').uncheck()
    await expect.poll(() => server.preferenze.giroModificato).toBe(false)
    await expect(page.getByTestId('pref-giro')).not.toBeChecked()

    await page.getByTestId('esci').click()
    await expect(page).toHaveURL(/\/login/)
    expect(server.log.filter(v => v === 'annulla' || v === 'logout')).toEqual(['annulla', 'logout'])
    expect(server.endpointRegistrati.size).toBe(0)
    expect((await statoFinto(page)).annullate).toBe(1)
  })

  test('riapertura con il dispositivo gia sottoscritto: scheda attiva e endpoint riallineato sul server', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications'])
    const server = nuovoServer()
    await preparaApi(page, server)
    await installaPushFinto(page)
    await page.addInitScript(() => {
      ;(window as unknown as { __push: { endpoint: string } }).__push.endpoint =
        'https://fcm.googleapis.com/fcm/send/gia-qui'
    })
    await entra(page)
    await expect(page.getByTestId('notifiche-attive')).toBeVisible()
    await expect
      .poll(() => [...server.endpointRegistrati])
      .toEqual(['https://fcm.googleapis.com/fcm/send/gia-qui'])
  })

  test('disattiva: toglie il dispositivo dal server e dal browser e torna il pulsante', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications'])
    const server = nuovoServer()
    await preparaApi(page, server)
    await installaPushFinto(page)
    await entra(page)
    await page.getByTestId('attiva-notifiche').click()
    await expect(page.getByTestId('notifiche-attive')).toBeVisible()
    await page.getByTestId('disattiva-notifiche').click()
    await expect(page.getByTestId('attiva-notifiche')).toBeVisible()
    expect(server.endpointRegistrati.size).toBe(0)
    expect((await statoFinto(page)).endpoint).toBeNull()
  })

  test('permesso rifiutato dal browser: nessuna sottoscrizione e il messaggio dice come sbloccare', async ({
    page,
    context,
  }) => {
    // Nessun grantPermissions: in Chromium senza interazione la richiesta si chiude con «denied».
    await context.clearPermissions()
    const server = nuovoServer()
    await preparaApi(page, server)
    await installaPushFinto(page)
    await entra(page)
    const attiva = page.getByTestId('attiva-notifiche')
    if (await attiva.isVisible()) await attiva.click()
    await expect(page.getByTestId('notifiche-negate')).toBeVisible()
    expect(server.endpointRegistrati.size).toBe(0)
    expect((await statoFinto(page)).sottoscritti).toBe(0)
  })

  test('server senza chiavi VAPID: la scheda non compare e il giro funziona', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications'])
    const server = nuovoServer()
    server.disponibile = false
    await preparaApi(page, server)
    await installaPushFinto(page)
    await entra(page)
    await expect(page.getByText('Nessun ritiro programmato')).toBeVisible()
    await expect(page.locator('app-notifiche section')).toHaveCount(0)
  })

  test('il server rifiuta la registrazione (503): la sottoscrizione del browser viene tolta e si vede un errore', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications'])
    const server = nuovoServer()
    server.rifiutaSottoscrizione = true
    await preparaApi(page, server)
    await installaPushFinto(page)
    await entra(page)
    await page.getByTestId('attiva-notifiche').click()
    await expect(page.getByTestId('notifiche-errore')).toBeVisible()
    await expect(page.getByTestId('attiva-notifiche')).toBeVisible()
    const s = await statoFinto(page)
    expect(s.endpoint).toBeNull()
    expect(s.annullate).toBe(1)
  })
})
