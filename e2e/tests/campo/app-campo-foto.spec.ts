import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { test, expect, devices, type Page, type Route } from '@playwright/test'
import { pushNonDisponibile } from '../../utils/campo-push'

/**
 * E2E - App campo P5 (foto e posizione al momento dell'esito) su viewport telefono.
 *
 * Percorso reale nel browser: PNG sintetica 3000x2000 -> compressione con canvas -> byte in
 * IndexedDB -> reload senza rete -> multipart con l'impronta SHA-256. Il server e' simulato con
 * `context.route` (come app-campo-eventi.spec.ts) ma ANALIZZA il multipart: ricalcola lo SHA-256,
 * controlla i magic bytes JPEG, il lato lungo (<= 1600) e la dimensione (<= 1 MiB), e rifiuta una
 * foto che arriva prima del suo evento. La parte d'ufficio (foto e posizione sull'esito) e' coperta
 * dai test Karma di `esiti-campo`: il frontend d'ufficio non e' servito da questo stack.
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
  permissions: ['geolocation'],
  geolocation: { latitude: 41.1171, longitude: 16.8719, accuracy: 15 },
})

const OGGI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
const MAX_BYTE = 1024 * 1024
const LATO_MAX = 1600

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

const sessione = JSON.stringify({
  accessToken: `h.${Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64url')}.s`,
  refreshToken: 'tok-r',
})

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

// --- Immagine sintetica -------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(tipo: string, dati: Buffer): Buffer {
  const t = Buffer.from(tipo, 'ascii')
  const lung = Buffer.alloc(4)
  lung.writeUInt32BE(dati.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, dati])))
  return Buffer.concat([lung, t, dati, crc])
}
/** PNG in scala di grigi con gradiente e rumore deterministico (non si comprime a quasi nulla). */
function pngSintetica(w: number, h: number): Buffer {
  const riga = w + 1
  const raw = Buffer.alloc(riga * h)
  let seme = 12345
  for (let y = 0; y < h; y++) {
    raw[y * riga] = 0
    for (let x = 0; x < w; x++) {
      seme = (seme * 1103515245 + 12345) & 0x7fffffff
      raw[y * riga + 1 + x] = ((x + y) / 20 + (seme >> 16)) & 0xff
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // profondita'
  ihdr[9] = 0 // grigi
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Larghezza e altezza dal primo marker SOF di un JPEG. */
function dimensioniJpeg(b: Buffer): { w: number; h: number } {
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('JPEG malformato')
    const m = b[i + 1]
    const lung = b.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    }
    i += 2 + lung
  }
  throw new Error('SOF non trovato')
}

// --- Finto server -------------------------------------------------------------------------------

interface FotoRicevuta {
  id: string
  eventoId: string
  sha256Dichiarato: string
  sha256Reale: string
  byte: Buffer
}

function nuovoServer() {
  return {
    spenta: false,
    richiesteFoto: 0,
    eventi: new Map<string, { id: string; dati: Record<string, unknown> }>(),
    foto: new Map<string, FotoRicevuta>(),
    /** Foto arrivate prima del loro evento (non devono esistere). */
    fotoPrimaDelEvento: 0,
    perdiRisposteFoto: 0,
    /** Se impostato, risponde 413 a ogni foto (limite superato). */
    rifiutaFoto: false,
  }
}
type Server = ReturnType<typeof nuovoServer>

/** Parser multipart minimo: campi di testo e file `foto`. */
function leggiMultipart(contentType: string, corpo: Buffer) {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1]
  if (!boundary) throw new Error('multipart senza boundary')
  const delim = Buffer.from(`--${boundary}`)
  const campi: Record<string, string> = {}
  let file: Buffer | null = null
  let pos = corpo.indexOf(delim)
  while (pos !== -1) {
    const inizio = pos + delim.length
    if (corpo.subarray(inizio, inizio + 2).toString() === '--') break
    const prossimo = corpo.indexOf(delim, inizio)
    if (prossimo === -1) break
    const parte = corpo.subarray(inizio + 2, prossimo - 2) // via \r\n iniziale e finale
    const fineTesta = parte.indexOf('\r\n\r\n')
    const testa = parte.subarray(0, fineTesta).toString()
    const dati = parte.subarray(fineTesta + 4)
    const nome = /name="([^"]+)"/.exec(testa)?.[1] ?? ''
    if (/filename=/.test(testa)) file = nome === 'foto' ? Buffer.from(dati) : file
    else campi[nome] = dati.toString()
    pos = prossimo
  }
  return { campi, file }
}

async function preparaApi(page: Page, server: Server) {
  const ctx = page.context()
  await ctx.route('**/api/v1/campo/giro**', route =>
    server.spenta ? route.abort('internetdisconnected') : json(route, GIRO)
  )
  await ctx.route('**/api/v1/campo/eventi', async route => {
    if (server.spenta) return route.abort('internetdisconnected')
    const corpo = route.request().postDataJSON() as { id: string; dati: Record<string, unknown> }
    if (!server.eventi.has(corpo.id)) server.eventi.set(corpo.id, corpo)
    return json(route, {
      id: corpo.id,
      esito: 'APPLICATO',
      motivoConflitto: null,
      ricevutoIl: new Date().toISOString(),
    })
  })
  await ctx.route('**/api/v1/campo/eventi/*/foto', async route => {
    if (server.spenta) return route.abort('internetdisconnected')
    server.richiesteFoto++
    const eventoId = /eventi\/([^/]+)\/foto/.exec(route.request().url())![1]
    if (!server.eventi.has(eventoId)) {
      server.fotoPrimaDelEvento++
      return json(route, { message: 'Evento non trovato.' }, 404)
    }
    if (server.rifiutaFoto) {
      return json(
        route,
        { message: 'La foto supera 1 MB anche dopo la compressione.', error: 'FOTO_TROPPO_GRANDE' },
        413
      )
    }
    const { campi, file } = leggiMultipart(
      route.request().headers()['content-type'] ?? '',
      route.request().postDataBuffer() as Buffer
    )
    if (!file) return json(route, { message: 'Serve la foto.' }, 400)
    const reale = createHash('sha256').update(file).digest('hex')
    if (reale !== campi.sha256) return json(route, { error: 'FOTO_HASH_NON_CORRISPONDENTE' }, 422)
    if (!server.foto.has(campi.id)) {
      server.foto.set(campi.id, {
        id: campi.id,
        eventoId,
        sha256Dichiarato: campi.sha256,
        sha256Reale: reale,
        byte: file,
      })
    }
    if (server.perdiRisposteFoto > 0) {
      server.perdiRisposteFoto--
      return route.abort('connectionreset')
    }
    return json(route, { id: campi.id, eventoId, sha256: reale })
  })
  await ctx.route('**/api/v1/auth/logout', route => json(route, { message: 'ok' }))
}

async function entra(page: Page) {
  await page.addInitScript(
    ([k, v]) => {
      if (!sessionStorage.getItem('inizializzato')) {
        sessionStorage.setItem('inizializzato', '1')
        localStorage.setItem(k, v)
      }
    },
    ['wasteflow.campo.sessione', sessione]
  )
  await page.goto('/campo/')
  await expect(page.getByTestId('elenco')).toBeVisible()
}

/** Foto ancora in coda nell'IndexedDB del telefono (byte compresi). */
async function fotoInArchivio(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ stato: string; byte: number }[]>((ok, ko) => {
        const r = indexedDB.open('wasteflow-campo-coda')
        r.onerror = () => ko(r.error)
        r.onsuccess = () => {
          const g = r.result.transaction('eventi').objectStore('eventi').getAll()
          g.onsuccess = () => {
            r.result.close()
            ok(
              (g.result as { foto?: { stato: string; contenuto: ArrayBuffer | null }[] }[]).flatMap(
                e =>
                  (e.foto ?? []).map(f => ({ stato: f.stato, byte: f.contenuto?.byteLength ?? 0 }))
              )
            )
          }
        }
      })
  )
}

const apriEsito = async (page: Page) => {
  await page.getByTestId('ritiro').filter({ hasText: 'Rossi Srl' }).click()
  await page.getByTestId('eseguito').click()
}

test.beforeEach(async ({ page }) => {
  await pushNonDisponibile(page)
})

test.describe('App campo P5: foto e posizione', () => {
  test.setTimeout(120_000)

  test('foto compressa e posizione: resta sul telefono dopo il reload offline e parte in multipart con l impronta, una volta, dopo l evento', async ({
    page,
  }) => {
    const server = nuovoServer()
    server.perdiRisposteFoto = 1 // la prima risposta si perde: il reinvio ha lo stesso uuid
    await preparaApi(page, server)
    await entra(page)
    await apriEsito(page)

    await page.getByTestId('file-foto').setInputFiles({
      name: 'ritiro.png',
      mimeType: 'image/png',
      buffer: pngSintetica(3000, 2000),
    })
    await expect(page.getByTestId('foto-pronta')).toHaveCount(1, { timeout: 60_000 })
    await expect(page.getByTestId('foto-pronta')).toContainText('kB')
    await page.getByTestId('aggiungi-posizione').click()
    await expect(page.getByTestId('posizione-pronta')).toContainText('± 15 m')

    // Rete spenta prima della conferma: evento e foto restano sul telefono.
    server.spenta = true
    await page.context().setOffline(true)
    await page.getByTestId('conferma-esito').click()
    await expect(page.getByTestId('esito-stato')).toContainText('in attesa di invio')
    await expect(page.getByTestId('esito-posizione')).toContainText('± 15 m')
    expect(server.eventi.size).toBe(0)

    // Riavvio dell'app con il server ancora irraggiungibile (le chiamate API cadono come in aereo;
    // senza service worker, bloccato nei test, la pagina stessa non si ricaricherebbe offline):
    // i byte della foto sopravvivono in IndexedDB.
    await page.context().setOffline(false)
    await page.reload()
    await expect(page.getByTestId('esito-stato')).toContainText('in attesa di invio')
    const dopoReload = await fotoInArchivio(page)
    expect(dopoReload).toHaveLength(1)
    expect(dopoReload[0].stato).toBe('DA_INVIARE')
    expect(dopoReload[0].byte).toBeGreaterThan(1000)
    expect(dopoReload[0].byte).toBeLessThanOrEqual(MAX_BYTE)

    // La rete torna: prima l evento, poi la foto.
    server.spenta = false
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    // Il reinvio dopo la risposta persa lo fa «Invia ora» o l intervallo di 20 s.
    await expect
      .poll(
        async () => {
          if (await page.getByTestId('invia-ora').count())
            await page.getByTestId('invia-ora').click()
          return (await fotoInArchivio(page))[0]?.stato
        },
        { timeout: 60_000, intervals: [1000] }
      )
      .toBe('INVIATA')

    // Il server ha un evento e UNA foto, arrivata dopo l evento, con l impronta giusta.
    expect(server.eventi.size).toBe(1)
    const [evento] = [...server.eventi.values()]
    expect(evento.dati.posizione).toEqual({ lat: 41.1171, lon: 16.8719, accuratezza: 15 })
    expect(server.fotoPrimaDelEvento).toBe(0)
    expect(server.foto.size).toBe(1)
    expect(server.richiesteFoto).toBeGreaterThanOrEqual(2) // reinvio dopo la risposta persa
    const [foto] = [...server.foto.values()]
    expect(foto.eventoId).toBe(evento.id)
    expect(foto.sha256Dichiarato).toBe(foto.sha256Reale)
    expect([...foto.byte.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect(foto.byte.length).toBeLessThanOrEqual(MAX_BYTE)
    const { w, h } = dimensioniJpeg(foto.byte)
    expect(Math.max(w, h)).toBeLessThanOrEqual(LATO_MAX)
    expect(Math.max(w, h)).toBeGreaterThan(1000) // ridimensionata, non ridotta a un francobollo
    expect(w / h).toBeCloseTo(1.5, 1)

    // I byte si liberano e non parte altro.
    expect((await fotoInArchivio(page))[0]).toEqual({ stato: 'INVIATA', byte: 0 })
    const richieste = server.richiesteFoto
    await page.waitForTimeout(1500)
    expect(server.richiesteFoto).toBe(richieste)
    await expect(page.getByTestId('esito-foto')).toContainText('1 foto inviate')
  })

  test('foto oltre il limite del server: rifiutata col motivo, byte liberati, nessun ritentativo; l esito resta inviato', async ({
    page,
  }) => {
    const server = nuovoServer()
    server.rifiutaFoto = true
    await preparaApi(page, server)
    await entra(page)
    await apriEsito(page)
    await page.getByTestId('file-foto').setInputFiles({
      name: 'ritiro.png',
      mimeType: 'image/png',
      buffer: pngSintetica(1200, 800),
    })
    await expect(page.getByTestId('foto-pronta')).toHaveCount(1, { timeout: 60_000 })
    await page.getByTestId('conferma-esito').click()

    await expect(page.getByTestId('foto-rifiutata')).toContainText('supera 1 MB', {
      timeout: 30_000,
    })
    expect(server.eventi.size).toBe(1)
    expect(server.foto.size).toBe(0)
    expect((await fotoInArchivio(page))[0]).toEqual({ stato: 'RIFIUTATA', byte: 0 })
    const richieste = server.richiesteFoto
    await page.waitForTimeout(1500)
    expect(server.richiesteFoto).toBe(richieste)
  })

  test('un file che non e una foto vera non entra nell esito: errore chiaro e l esito si puo dare lo stesso', async ({
    page,
  }) => {
    const server = nuovoServer()
    await preparaApi(page, server)
    await entra(page)
    await apriEsito(page)
    await page.getByTestId('file-foto').setInputFiles({
      name: 'finta.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('questo non e un JPEG'),
    })
    await expect(page.getByTestId('errore-allegati')).toContainText('foto')
    await expect(page.getByTestId('foto-pronta')).toHaveCount(0)
    await page.getByTestId('conferma-esito').click()
    await expect(page.getByTestId('esito-stato')).toContainText('inviato')
    expect(server.eventi.size).toBe(1)
    expect(server.richiesteFoto).toBe(0)
  })
})
