import { test, expect, devices, type Page, type Route } from '@playwright/test'

/**
 * E2E - App campo P4 (esiti dal campo) su viewport telefono, con la rete che va e viene.
 *
 * Il server e' simulato con `context.route`: tiene gli eventi per uuid (come l'indice unico del
 * backend) e conta le richieste. `rete.spenta` allinea la route a `setOffline`, cosi la richiesta
 * cade come in aereo. Si verifica che nessun esito vada perso o raddoppiato, anche quando la
 * risposta del server si perde per strada e quando il telefono passa a un collega.
 */
const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = devices['Pixel 7']
test.use({
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
  serviceWorkers: 'block',
  timezoneId: 'Europe/Rome',
})

const OGGI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())

const ritiro = (id: string, nome: string, ordine: number) => ({
  id,
  dataPrevista: OGGI,
  fascia: 'MATTINA',
  ordineGiro: ordine,
  produttore: { id: `p${ordine}`, nome, sedeId: 's', indirizzo: `Via Roma ${ordine}, Bari` },
  trasportatore: { id: 't', nome: 'Trasporti Sud' },
  destinatario: { id: 'd', nome: 'Impianto Nord', sedeId: 'sd' },
  automezzo: null,
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
  versione: 4,
})

const GIRO = {
  data: OGGI,
  autista: { id: 'au', nome: 'Luca', cognome: 'Bianchi' },
  ritiri: [ritiro('r1', 'Rossi Srl', 1), ritiro('r2', 'Verdi Spa', 2)],
}

const sessione = (utente: string) =>
  JSON.stringify({
    accessToken: `h.${Buffer.from(JSON.stringify({ sub: utente })).toString('base64url')}.s`,
    refreshToken: 'tok-r',
  })

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

interface EventoRicevuto {
  id: string
  ritiroId: string
  tipo: string
  versioneVista: number
  dati: Record<string, string>
}

/** Stato del finto server: la verita per i controlli (righe uniche per uuid, richieste totali). */
function nuovoServer() {
  return {
    spenta: false,
    richieste: 0,
    eventi: new Map<string, EventoRicevuto>(),
    /** Quante risposte perdere DOPO aver scritto l'evento (il telefono non lo sa). */
    perdiRisposte: 0,
  }
}
type Server = ReturnType<typeof nuovoServer>

async function reteSpenta(page: Page, server: Server, spenta: boolean) {
  server.spenta = spenta
  await page.context().setOffline(spenta)
}

async function preparaApi(page: Page, server: Server) {
  await page
    .context()
    .route('**/api/v1/campo/giro**', route =>
      server.spenta ? route.abort('internetdisconnected') : json(route, GIRO)
    )
  await page.context().route('**/api/v1/campo/eventi', async route => {
    if (server.spenta) return route.abort('internetdisconnected')
    server.richieste++
    const corpo = route.request().postDataJSON() as EventoRicevuto
    if (!server.eventi.has(corpo.id)) server.eventi.set(corpo.id, corpo)
    if (server.perdiRisposte > 0) {
      server.perdiRisposte--
      return route.abort('connectionreset')
    }
    return json(route, {
      id: corpo.id,
      esito: 'APPLICATO',
      motivoConflitto: null,
      ricevutoIl: new Date().toISOString(),
    })
  })
  await page.context().route('**/api/v1/auth/logout', route => json(route, { message: 'ok' }))
}

async function entra(page: Page, utente: string) {
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
  await expect(page.getByTestId('elenco')).toBeVisible()
}

async function esitoNonEseguito(page: Page, ritiroNome: string, motivo: string) {
  await page.getByTestId('ritiro').filter({ hasText: ritiroNome }).click()
  await page.getByTestId('non-eseguito').click()
  await page.getByTestId('testo-esito').fill(motivo)
  await page.getByTestId('conferma-esito').click()
}

test.describe('App campo P4: esiti con la rete che va e viene', () => {
  test.setTimeout(90_000)

  test('esito registrato offline: resta sul telefono (anche dopo il riavvio) e parte UNA volta al ritorno della rete', async ({
    page,
  }) => {
    const server = nuovoServer()
    await preparaApi(page, server)
    await entra(page, 'u1')

    await reteSpenta(page, server, true)
    await esitoNonEseguito(page, 'Rossi Srl', 'Cliente assente')
    await expect(page.getByTestId('esito-stato')).toContainText('in attesa di invio')
    await expect(page.getByTestId('da-inviare')).toContainText('1 esito da inviare')
    expect(server.eventi.size).toBe(0)

    // La rete del telefono torna ma il server non risponde ancora: l'esito resta in coda.
    server.spenta = true
    await page.context().setOffline(false)
    await page.waitForTimeout(800)
    await expect(page.getByTestId('esito-stato')).toContainText('in attesa di invio')

    // Riavvio dell'app: la coda e' in IndexedDB, il giro dallo snapshot.
    await page.reload()
    await expect(page.getByTestId('esito-stato')).toContainText('in attesa di invio')
    await page.getByTestId('indietro').click()
    await expect(page.getByTestId('elenco')).toBeVisible()
    await expect(page.getByTestId('da-inviare')).toContainText('1 esito da inviare')
    await expect(page.getByTestId('badge-esito')).toContainText('Non eseguito · da inviare')

    // Il server torna: parte da sola (evento «online» / intervallo), una volta sola.
    server.spenta = false
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.getByTestId('da-inviare')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByTestId('badge-esito')).toContainText('inviato')
    expect(server.eventi.size).toBe(1)
    expect([...server.eventi.values()][0]).toMatchObject({
      ritiroId: 'r1',
      tipo: 'RITIRO_NON_ESEGUITO',
      versioneVista: 4,
      dati: { motivo: 'Cliente assente' },
    })
    const richiesteDopoInvio = server.richieste
    await page.waitForTimeout(1500)
    expect(server.richieste).toBe(richiesteDopoInvio)
  })

  test('risposta persa per strada: il reinvio ha lo stesso uuid e sul server resta una riga sola', async ({
    page,
  }) => {
    const server = nuovoServer()
    server.perdiRisposte = 2
    await preparaApi(page, server)
    await entra(page, 'u1')

    await page.getByTestId('ritiro').filter({ hasText: 'Verdi Spa' }).click()
    await page.getByTestId('eseguito').click()
    await page.getByTestId('conferma-esito').click()

    // Le prime due risposte si perdono; il pulsante «Invia ora» ritenta.
    await expect(page.getByTestId('esito-stato')).toContainText('in attesa di invio')
    for (
      let i = 0;
      i < 6 && (await page.getByTestId('esito-stato').textContent())?.includes('attesa');
      i++
    ) {
      await page
        .getByTestId('invia-ora')
        .click({ trial: false })
        .catch(() => undefined)
      await page.waitForTimeout(400)
    }
    await expect(page.getByTestId('esito-stato')).toContainText("inviato all'ufficio", {
      timeout: 30_000,
    })
    expect(server.richieste).toBeGreaterThanOrEqual(3)
    expect(server.eventi.size).toBe(1)
  })

  test('niente doppioni: due tocchi ravvicinati su «Conferma» registrano un esito solo', async ({
    page,
  }) => {
    const server = nuovoServer()
    await preparaApi(page, server)
    await entra(page, 'u1')
    await page.getByTestId('ritiro').filter({ hasText: 'Rossi Srl' }).click()
    await page.getByTestId('eseguito').click()
    await page
      .getByTestId('conferma-esito')
      .dblclick()
      .catch(() => undefined)
    await expect(page.getByTestId('esito-stato')).toContainText("inviato all'ufficio")
    expect(server.eventi.size).toBe(1)
  })

  test('telefono passato a un collega: gli esiti del primo non partono col token del secondo e tornano quando rientra', async ({
    page,
  }) => {
    const server = nuovoServer()
    await preparaApi(page, server)
    await entra(page, 'u1')
    // Il server non risponde (il telefono non sa se e' la rete: nessun evento «online» in arrivo).
    server.spenta = true
    await esitoNonEseguito(page, 'Rossi Srl', 'Strada chiusa')
    await expect(page.getByTestId('da-inviare')).toBeVisible()

    // Il collega entra sullo stesso telefono (sessione di un altro utente). Il server e la rete
    // ci sono, ma l'esito di u1 non deve partire col token di u2.
    server.spenta = false
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      ['wasteflow.campo.sessione', sessione('u2')]
    )
    await page.goto('/campo/')
    await expect(page.getByTestId('elenco')).toBeVisible()
    await expect(page.getByTestId('altri-utenti')).toContainText(
      '1 esito non inviato di un altro utente'
    )
    await expect(page.getByTestId('da-inviare')).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect(server.eventi.size).toBe(0)

    // Il primo utente rientra: il suo esito parte.
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      ['wasteflow.campo.sessione', sessione('u1')]
    )
    await page.goto('/campo/')
    await expect(page.getByTestId('elenco')).toBeVisible()
    await expect.poll(() => server.eventi.size, { timeout: 30_000 }).toBe(1)
    await expect(page.getByTestId('altri-utenti')).toHaveCount(0)
  })
})
