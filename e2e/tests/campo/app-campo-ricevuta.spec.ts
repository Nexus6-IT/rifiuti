import { test, expect, devices, type Page, type Route } from '@playwright/test'
import { pushNonDisponibile } from '../../utils/campo-push'

/**
 * E2E - App campo P6 (ricevuta di ritiro con firma su canvas) su viewport telefono.
 *
 * Il server e' simulato con `context.route`: tiene le ricevute per uuid (come l'indice unico del
 * backend) e conta le richieste. Si verifica che la firma disegnata sul canvas diventi un PNG vero
 * (non bianco), che resti sul telefono finche' non e' arrivata, che il reinvio dopo una risposta
 * persa non raddoppi nulla, e che l'interfaccia dica onestamente cos'e' la ricevuta.
 * Il PDF lo genera il backend (provato dai test Postgres); qui il server finto risponde con le
 * impronte.
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

const GIRO = {
  data: OGGI,
  autista: { id: 'au', nome: 'Luca', cognome: 'Bianchi' },
  ritiri: [
    {
      id: 'r1',
      dataPrevista: OGGI,
      fascia: 'MATTINA',
      ordineGiro: 1,
      produttore: { id: 'p1', nome: 'Rossi Srl', sedeId: 's', indirizzo: 'Via Roma 1, Bari' },
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
    },
  ],
}

const sessione = (utente: string) =>
  JSON.stringify({
    accessToken: `h.${Buffer.from(JSON.stringify({ sub: utente })).toString('base64url')}.s`,
    refreshToken: 'tok-r',
  })

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

interface RicevutaRicevuta {
  id: string
  ritiroId: string
  firmatarioNome: string
  firmatoIl: string
  firmaPng: string
  emailCliente?: string
}

function nuovoServer() {
  return {
    spenta: false,
    richieste: 0,
    invioEmail: false,
    ricevute: new Map<string, RicevutaRicevuta>(),
    /** Quante risposte perdere DOPO aver scritto la ricevuta (il telefono non lo sa). */
    perdiRisposte: 0,
    /** Se impostato, risponde con questo errore invece di accettare. */
    rifiuta: null as null | { status: number; message: string },
    /** Se true il server archivia «da riconciliare» (ritiro cambiato mentre il telefono era offline). */
    daRiconciliare: false,
  }
}
type Server = ReturnType<typeof nuovoServer>

async function preparaApi(page: Page, server: Server) {
  const ctx = page.context()
  await ctx.route('**/api/v1/campo/giro**', route =>
    server.spenta ? route.abort('internetdisconnected') : json(route, GIRO)
  )
  await ctx.route('**/api/v1/campo/ricevute/configurazione', route =>
    server.spenta
      ? route.abort('internetdisconnected')
      : json(route, { invioEmail: server.invioEmail })
  )
  await ctx.route('**/api/v1/campo/ricevute', async route => {
    if (server.spenta) return route.abort('internetdisconnected')
    server.richieste++
    if (server.rifiuta) {
      return json(route, { message: server.rifiuta.message }, server.rifiuta.status)
    }
    const corpo = route.request().postDataJSON() as RicevutaRicevuta
    if (!server.ricevute.has(corpo.id)) server.ricevute.set(corpo.id, corpo)
    if (server.perdiRisposte > 0) {
      server.perdiRisposte--
      return route.abort('connectionreset')
    }
    return json(route, {
      id: corpo.id,
      ricevutoIl: new Date().toISOString(),
      pdfSha256: 'a'.repeat(64),
      contenutoSha256: 'b'.repeat(64),
      invio: corpo.emailCliente ? 'INVIATO' : 'NON_RICHIESTO',
      esito: server.daRiconciliare ? 'DA_RICONCILIARE' : 'REGISTRATA',
    })
  })
  await ctx.route('**/api/v1/auth/logout', route => json(route, { message: 'ok' }))
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

async function apriRicevuta(page: Page) {
  await page.getByTestId('ritiro').filter({ hasText: 'Rossi Srl' }).click()
  await page.getByTestId('apri-ricevuta').click()
  await expect(page.getByTestId('tela-firma')).toBeVisible()
}

/** Disegna una "firma" con il mouse sulla tela (gli eventi puntatore arrivano come col dito). */
async function firma(page: Page, lunga = true) {
  const tela = page.getByTestId('tela-firma')
  const box = (await tela.boundingBox())!
  const x = (f: number) => box.x + box.width * f
  const y = (f: number) => box.y + box.height * f
  await page.mouse.move(x(0.1), y(0.6))
  await page.mouse.down()
  if (lunga) {
    for (let i = 0; i <= 20; i++) {
      await page.mouse.move(x(0.1 + i * 0.04), y(0.5 + 0.3 * Math.sin(i / 2)))
    }
  } else {
    await page.mouse.move(x(0.1) + 4, y(0.6) + 2)
  }
  await page.mouse.up()
}

/** Ricevute nell'archivio IndexedDB del telefono (letto dal browser). */
const ricevuteSalvate = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<Record<string, unknown>>>((risolvi, rifiuta) => {
        const rich = indexedDB.open('wasteflow-campo-ricevute', 1)
        rich.onerror = () => rifiuta(rich.error)
        rich.onsuccess = () => {
          const db = rich.result
          const tx = db.transaction('ricevute', 'readonly')
          const tutte = tx.objectStore('ricevute').getAll()
          tutte.onsuccess = () => {
            db.close()
            risolvi(tutte.result as Array<Record<string, unknown>>)
          }
          tutte.onerror = () => rifiuta(tutte.error)
        }
      })
  )

test.beforeEach(async ({ page }) => {
  await pushNonDisponibile(page)
})

test.describe('App campo P6: ricevuta di ritiro con firma su schermo', () => {
  test.setTimeout(90_000)

  test('dice onestamente che non sostituisce il FIR e che la firma e semplice', async ({
    page,
  }) => {
    const server = nuovoServer()
    await preparaApi(page, server)
    await entra(page, 'u1')
    await page.getByTestId('ritiro').filter({ hasText: 'Rossi Srl' }).click()
    await expect(page.getByTestId('ricevuta')).toContainText('Non sostituisce il FIR')
    await expect(page.getByTestId('ricevuta')).toContainText('non è una firma qualificata')
    await page.getByTestId('apri-ricevuta').click()
    const avviso = page.getByTestId('avviso-valore')
    await expect(avviso).toContainText('Non sostituisce il FIR')
    await expect(avviso).toContainText('firma elettronica semplice')
    await expect(avviso).toContainText('Non è una firma qualificata')
    await expect(page.getByTestId('riepilogo')).toContainText('quantità presunta')
    // L'invio al cliente e' spento per default: nessun campo email.
    await expect(page.getByTestId('email-cliente')).toHaveCount(0)
  })

  test('firma offline: PNG vero (non bianco) sul telefono anche dopo il riavvio; al ritorno della rete parte UNA volta, con risposte perse il reinvio non raddoppia', async ({
    page,
  }) => {
    const server = nuovoServer()
    server.perdiRisposte = 1
    await preparaApi(page, server)
    await entra(page, 'u1')
    await apriRicevuta(page)

    server.spenta = true
    await page.context().setOffline(true)
    await page.getByTestId('nome-firmatario').fill('Mario Verdi')
    await firma(page)
    await page.getByTestId('conferma-firma').click()
    await expect(page.getByTestId('stato-ricevuta')).toContainText('in attesa di invio')
    expect(server.ricevute.size).toBe(0)

    // La firma e' sul telefono: PNG valido 600x240 con del tratto scuro, non una tela bianca.
    const salvate = await ricevuteSalvate(page)
    expect(salvate).toHaveLength(1)
    expect(salvate[0]).toMatchObject({
      ritiroId: 'r1',
      firmatarioNome: 'Mario Verdi',
      stato: 'DA_INVIARE',
    })
    const png = salvate[0].firmaPng as string
    const analisi = await page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const magic = Array.from(bytes.slice(0, 8))
      const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const cx = c.getContext('2d')!
      cx.drawImage(img, 0, 0)
      const d = cx.getImageData(0, 0, c.width, c.height).data
      let scuri = 0
      let trasparenti = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 255) trasparenti++
        else if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) scuri++
      }
      return { magic, w: img.width, h: img.height, scuri, trasparenti, byte: bytes.length }
    }, png)
    expect(analisi.magic).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect([analisi.w, analisi.h]).toEqual([600, 240])
    expect(analisi.scuri).toBeGreaterThan(300)
    expect(analisi.trasparenti).toBe(0) // sfondo bianco opaco: nel PDF non diventa nero
    expect(analisi.byte).toBeLessThan(131_072)

    // Riavvio con server ancora irraggiungibile: la ricevuta e ancora li.
    server.spenta = true
    await page.context().setOffline(false)
    await page.reload()
    expect(await ricevuteSalvate(page)).toHaveLength(1)
    await expect(page.getByTestId('ricevute-da-inviare')).toContainText('1 ricevuta da inviare')

    // Il server torna: la prima risposta si perde, il reinvio ha lo stesso uuid.
    server.spenta = false
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(async () => {
      const r = await ricevuteSalvate(page)
      expect(r[0]?.stato).toBe('DA_INVIARE')
      expect(server.richieste).toBeGreaterThanOrEqual(1)
    }).toPass({ timeout: 15_000 })
    await page.getByTestId('ricevute-invia-ora').click()
    await expect(page.getByTestId('ricevute-da-inviare')).toHaveCount(0, { timeout: 30_000 })

    expect(server.ricevute.size).toBe(1)
    const [r] = [...server.ricevute.values()]
    expect(r).toMatchObject({ ritiroId: 'r1', firmatarioNome: 'Mario Verdi' })
    expect(r.firmaPng).toBe(png)
    expect(server.richieste).toBe(2)

    // Arrivata: sul telefono restano solo le impronte, non l'immagine della firma.
    const dopo = await ricevuteSalvate(page)
    expect(dopo[0]).toMatchObject({ stato: 'CONFERMATO', firmaPng: null, emailCliente: null })
    const richieste = server.richieste
    await page.waitForTimeout(1500)
    expect(server.richieste).toBe(richieste)

    // Dal ritiro si vede lo stato.
    await page
      .getByTestId('indietro')
      .click()
      .catch(() => undefined)
    await page.goto('/campo/ritiro/r1')
    await expect(page.getByTestId('ricevuta-stato')).toContainText("inviata all'ufficio")
  })

  test('senza nome, senza firma o con un puntino non parte nulla; firma cancellata = tela vuota', async ({
    page,
  }) => {
    const server = nuovoServer()
    await preparaApi(page, server)
    await entra(page, 'u1')
    await apriRicevuta(page)

    await page.getByTestId('conferma-firma').click()
    await expect(page.getByTestId('errore-firma')).toContainText('nome')
    await page.getByTestId('nome-firmatario').fill('Mario Verdi')
    await page.getByTestId('conferma-firma').click()
    await expect(page.getByTestId('errore-firma')).toContainText('firma')
    await firma(page, false)
    await page.getByTestId('conferma-firma').click()
    await expect(page.getByTestId('errore-firma')).toContainText('troppo breve')
    await firma(page)
    await page.getByTestId('cancella-firma').click()
    await page.getByTestId('conferma-firma').click()
    await expect(page.getByTestId('errore-firma')).toContainText('firma')

    expect(server.richieste).toBe(0)
    expect(await ricevuteSalvate(page)).toHaveLength(0)
  })

  test('il server archivia «da riconciliare» (ritiro cambiato a telefono offline): la ricevuta non si perde e l autista lo vede', async ({
    page,
  }) => {
    const server = nuovoServer()
    server.daRiconciliare = true
    await preparaApi(page, server)
    await entra(page, 'u1')
    await apriRicevuta(page)
    await page.getByTestId('nome-firmatario').fill('Mario Verdi')
    await firma(page)
    await page.getByTestId('conferma-firma').click()
    await expect(page.getByTestId('stato-ricevuta')).toContainText('archiviata')
    await expect(page.getByTestId('stato-ricevuta')).toContainText("l'ufficio la verificherà")
    expect(server.richieste).toBe(1)
    const [r] = await ricevuteSalvate(page)
    expect(r).toMatchObject({ stato: 'CONFERMATO', firmaPng: null })
  })

  test('il server rifiuta (es. limite di ricevute per ritiro): lo dice col motivo, nessun ritentativo, la firma NON si perde', async ({
    page,
  }) => {
    const server = nuovoServer()
    server.rifiuta = {
      status: 409,
      message: 'Per questo ritiro ci sono già 5 ricevute: contatta l’ufficio.',
    }
    await preparaApi(page, server)
    await entra(page, 'u1')
    await apriRicevuta(page)
    await page.getByTestId('nome-firmatario').fill('Mario Verdi')
    await firma(page)
    await page.getByTestId('conferma-firma').click()
    await expect(page.getByTestId('stato-ricevuta')).toContainText('Non accettata dal server')
    await expect(page.getByTestId('stato-ricevuta')).toContainText('già 5 ricevute')
    await page.waitForTimeout(1200)
    expect(server.richieste).toBe(1)
    const [r] = await ricevuteSalvate(page)
    expect(r).toMatchObject({ stato: 'RIFIUTATO' })
    expect(typeof r.firmaPng).toBe('string')
  })

  test('con l invio al cliente acceso compare il campo email e parte nel corpo; spento non parte mai', async ({
    page,
  }) => {
    const server = nuovoServer()
    server.invioEmail = true
    await preparaApi(page, server)
    await entra(page, 'u1')
    await apriRicevuta(page)
    await page.getByTestId('nome-firmatario').fill('Mario Verdi')
    await page.getByTestId('email-cliente').fill('cliente@esempio.it')
    await firma(page)
    await page.getByTestId('conferma-firma').click()
    await expect(page.getByTestId('stato-ricevuta')).toContainText('Copia spedita al cliente')
    const [r] = [...server.ricevute.values()]
    expect(r.emailCliente).toBe('cliente@esempio.it')
    // L'indirizzo non resta sul telefono dopo l'invio.
    const [salvata] = await ricevuteSalvate(page)
    expect(salvata.emailCliente).toBeNull()
  })
})
