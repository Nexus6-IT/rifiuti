'use strict'
/**
 * Server HTTP del provider SDI finto. Sottoinsieme dell'API di un provider (invio, lettura,
 * configurazione P.IVA) piu' la consegna del webhook firmato; nessuna dipendenza npm.
 *
 * Rotte (autenticate con `Authorization: Bearer <apiKey>`, la chiave `KO` e' sempre rifiutata):
 *   PUT  /v1/configurazioni/:piva      {webhookUrl?, segreto?, consegnaWebhook?}
 *   GET  /v1/configurazioni/:piva
 *   POST /v1/fatture                   {nomeFile, xmlBase64, cedentePartitaIva, firma?} + `Idempotency-Key`
 *   GET  /v1/fatture?chiaveIdempotenza=&nomeFile=      (riconciliazione: 200 o 404)
 *   GET  /v1/fatture/:id/notifiche                     (polling di ripiego)
 * Senza autenticazione, solo per i test e il collaudo:
 *   GET /__salute, GET /__stato, POST /__reset, POST /__riconsegna/:idProvider
 *
 * Solo collaudo: mai in produzione, nessuna chiamata esterna.
 */
const http = require('node:http')
const { INTESTAZIONE_FIRMA, firmaWebhook } = require('./firma')
const { scenarioDaXml, notificheDelloScenario } = require('./scenari')

const PIVA = /^\d{11}$/
const LIMITE_CORPO = 5 * 1024 * 1024

function creaServer(opzioni = {}) {
  const ritardoWebhookMs = opzioni.ritardoWebhookMs ?? 500
  const tentativiWebhook = opzioni.tentativiWebhook ?? 7
  const attesaRitentoMs = opzioni.attesaRitentoMs ?? 1000
  const adesso = opzioni.adesso ?? (() => new Date())

  /** @type {Map<string, {webhookUrl?: string, segreto?: string, consegnaWebhook: boolean}>} */
  const configurazioni = new Map()
  const perChiave = new Map()
  const perId = new Map()
  let contatore = 0
  let webhookConsegnati = 0
  const timer = new Set()

  const json = (res, stato, corpo, intestazioni = {}) => {
    const testo = JSON.stringify(corpo)
    res.writeHead(stato, { 'content-type': 'application/json', ...intestazioni })
    res.end(testo)
  }

  const leggiCorpo = req =>
    new Promise((resolve, reject) => {
      const pezzi = []
      let tot = 0
      req.on('data', c => {
        tot += c.length
        if (tot > LIMITE_CORPO) {
          reject(new Error('corpo troppo grande'))
          req.destroy()
          return
        }
        pezzi.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(pezzi)))
      req.on('error', reject)
    })

  async function consegnaEvento(invio, notifica) {
    const conf = configurazioni.get(invio.cedente)
    if (!conf || !conf.webhookUrl || !conf.segreto || !conf.consegnaWebhook) return
    const corpo = Buffer.from(
      JSON.stringify({ id: `evt-${notifica.idNotifica}`, idProvider: invio.idProvider, notifica })
    )
    for (let i = 1; i <= tentativiWebhook; i++) {
      try {
        const t = Math.floor(adesso().getTime() / 1000)
        const r = await fetch(conf.webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [INTESTAZIONE_FIRMA]: firmaWebhook(corpo, conf.segreto, t),
          },
          body: corpo,
          signal: AbortSignal.timeout(5000),
        })
        if (r.ok) {
          webhookConsegnati++
          return
        }
      } catch {
        // rete o timeout: si ritenta, come un provider che garantisce «almeno una volta»
      }
      await new Promise(r => {
        const h = setTimeout(r, attesaRitentoMs * i)
        timer.add(h)
      })
    }
  }

  function pianificaWebhook(invio) {
    const h = setTimeout(async () => {
      timer.delete(h)
      for (const n of invio.notifiche) await consegnaEvento(invio, n)
    }, ritardoWebhookMs)
    timer.add(h)
  }

  async function gestisci(req, res) {
    const url = new URL(req.url, 'http://fake')
    const percorso = url.pathname
    const metodo = req.method

    if (percorso === '/__salute') return json(res, 200, { ok: true })
    if (percorso === '/__stato' && metodo === 'GET') return json(res, 200, stato())
    if (percorso === '/__reset' && metodo === 'POST') {
      reset()
      return json(res, 200, { ok: true })
    }
    const riconsegna = /^\/__riconsegna\/([^/]+)$/.exec(percorso)
    if (riconsegna && metodo === 'POST') {
      const invio = perId.get(riconsegna[1])
      if (!invio) return json(res, 404, { codice: 'NON_TROVATO' })
      pianificaWebhook(invio)
      return json(res, 200, { ok: true })
    }

    if (!percorso.startsWith('/v1/')) return json(res, 404, { codice: 'NON_TROVATO' })

    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    if (!auth || auth[1] === 'KO') return json(res, 401, { codice: 'NON_AUTORIZZATO' })

    const conf = /^\/v1\/configurazioni\/([^/]+)$/.exec(percorso)
    if (conf) {
      const piva = conf[1]
      if (!PIVA.test(piva)) return json(res, 400, { codice: 'PIVA_NON_VALIDA' })
      if (metodo === 'GET') {
        const c = configurazioni.get(piva)
        if (!c) return json(res, 404, { codice: 'PIVA_NON_CONFIGURATA' })
        return json(res, 200, { partitaIva: piva, webhookUrl: c.webhookUrl ?? null })
      }
      if (metodo === 'PUT') {
        const c = JSON.parse((await leggiCorpo(req)).toString('utf8') || '{}')
        if (c.webhookUrl !== undefined && !/^https?:\/\//.test(String(c.webhookUrl))) {
          return json(res, 400, { codice: 'WEBHOOK_URL_NON_VALIDO' })
        }
        configurazioni.set(piva, {
          webhookUrl: c.webhookUrl,
          segreto: c.segreto,
          consegnaWebhook: c.consegnaWebhook !== false,
        })
        return json(res, 200, { partitaIva: piva })
      }
    }

    if (percorso === '/v1/fatture' && metodo === 'POST') return invia(req, res)

    if (percorso === '/v1/fatture' && metodo === 'GET') {
      const chiave = url.searchParams.get('chiaveIdempotenza')
      const nome = url.searchParams.get('nomeFile')
      const r =
        (chiave && perChiave.get(chiave)) ||
        [...perId.values()].find(x => nome && x.nomeFile === nome)
      if (!r) return json(res, 404, { codice: 'NON_TROVATO' })
      return json(res, 200, { idProvider: r.idProvider, idSdi: r.idSdi })
    }

    const notif = /^\/v1\/fatture\/([^/]+)\/notifiche$/.exec(percorso)
    if (notif && metodo === 'GET') {
      const r = perId.get(notif[1])
      if (!r) return json(res, 404, { codice: 'NON_TROVATO' })
      return json(res, 200, r.notifiche)
    }

    return json(res, 404, { codice: 'NON_TROVATO' })
  }

  async function invia(req, res) {
    const chiave = req.headers['idempotency-key']
    if (!chiave) return json(res, 400, { codice: 'CHIAVE_IDEMPOTENZA_MANCANTE' })
    let c
    try {
      c = JSON.parse((await leggiCorpo(req)).toString('utf8'))
    } catch {
      return json(res, 400, { codice: 'CORPO_NON_VALIDO' })
    }
    if (typeof c.nomeFile !== 'string' || typeof c.xmlBase64 !== 'string') {
      return json(res, 400, { codice: 'CORPO_NON_VALIDO' })
    }
    const gia = perChiave.get(chiave)
    if (gia) return rispostaDiInvio(res, gia)

    if (!configurazioni.has(String(c.cedentePartitaIva))) {
      return json(res, 422, {
        codice: 'PIVA_NON_CONFIGURATA',
        messaggio: 'Partita IVA non configurata',
      })
    }
    const xml = Buffer.from(c.xmlBase64, 'base64')
    const scenario = scenarioDaXml(xml)
    if (scenario === null) {
      return json(res, 422, { codice: 'XML_NON_VALIDO', messaggio: 'Cessionario non identificabile' })
    }
    if (scenario === 'TRANSITORIO') {
      return json(res, 503, { codice: 'HTTP_503' }, { 'retry-after': '1' })
    }
    if (scenario === 'RIFIUTATO') {
      return json(res, 422, {
        codice: 'PIVA_NON_CONFIGURATA',
        messaggio: 'Partita IVA non configurata',
      })
    }
    if (scenario === 'INCERTO_PERSO') {
      // Il provider non ha registrato nulla e la connessione cade: l'invio e' incerto.
      req.socket.destroy()
      return
    }

    contatore++
    const idProvider = `fake-${contatore}`
    const invio = {
      idProvider,
      idSdi: `sdi-${contatore}`,
      nomeFile: c.nomeFile,
      cedente: String(c.cedentePartitaIva),
      scenario,
      notifiche: notificheDelloScenario(scenario, idProvider, adesso()),
    }
    perChiave.set(chiave, invio)
    perId.set(idProvider, invio)
    pianificaWebhook(invio)
    return rispostaDiInvio(res, invio)
  }

  function rispostaDiInvio(res, invio) {
    if (invio.scenario === 'INCERTO_ARRIVATO') {
      // Registrato ma la risposta non arriva mai (timeout dopo l'invio dei byte).
      res.socket.destroy()
      return
    }
    json(res, 201, { idProvider: invio.idProvider, idSdi: invio.idSdi })
  }

  function stato() {
    return { invii: perChiave.size, webhookConsegnati, configurazioni: configurazioni.size }
  }

  function reset() {
    for (const h of timer) clearTimeout(h)
    timer.clear()
    configurazioni.clear()
    perChiave.clear()
    perId.clear()
    contatore = 0
    webhookConsegnati = 0
  }

  const server = http.createServer((req, res) => {
    gestisci(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { codice: 'ERRORE_INTERNO' })
      else res.destroy()
    })
  })

  return {
    server,
    stato,
    reset,
    chiudi: () =>
      new Promise(resolve => {
        reset()
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

module.exports = { creaServer }
