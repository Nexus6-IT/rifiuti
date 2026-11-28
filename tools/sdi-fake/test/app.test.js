const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { creaServer } = require('../src/app')
const { verificaFirma } = require('../src/firma')

const CEDENTE = '01234567890'
const SEGRETO = 'segreto-webhook'
const KEY = 'chiave-api'

const fattura = id =>
  `<p:FatturaElettronica><CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${id}</IdCodice></IdFiscaleIVA></DatiAnagrafici></CessionarioCommittente></p:FatturaElettronica>`

/** Riceve i webhook e li accumula. */
async function ricevitore(stato = 200) {
  const ricevuti = []
  const srv = http.createServer((req, res) => {
    const pezzi = []
    req.on('data', c => pezzi.push(c))
    req.on('end', () => {
      ricevuti.push({ url: req.url, intestazioni: req.headers, corpo: Buffer.concat(pezzi) })
      res.statusCode = stato
      res.end('{}')
    })
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  return { ricevuti, url: `http://127.0.0.1:${srv.address().port}`, chiudi: () => srv.close() }
}

async function avvia(opzioni = {}) {
  const fake = creaServer({
    ritardoWebhookMs: 0,
    tentativiWebhook: 3,
    attesaRitentoMs: 5,
    ...opzioni,
  })
  await new Promise(r => fake.server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${fake.server.address().port}`
  const chiama = (metodo, percorso, corpo, intestazioni = {}) =>
    fetch(base + percorso, {
      method: metodo,
      headers: {
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
        ...intestazioni,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
  return { ...fake, base, chiama, chiudi: () => fake.chiudi() }
}

const attendi = async (cond, ms = 2000) => {
  const fine = Date.now() + ms
  while (Date.now() < fine) {
    if (cond()) return
    await new Promise(r => setTimeout(r, 10))
  }
  assert.fail('condizione non raggiunta in tempo')
}

async function configurata(webhookUrl) {
  const f = await avvia()
  const r = await f.chiama('PUT', `/v1/configurazioni/${CEDENTE}`, { webhookUrl, segreto: SEGRETO })
  assert.equal(r.status, 200)
  return f
}

const invia = (f, id, chiave, extra = {}) =>
  f.chiama(
    'POST',
    '/v1/fatture',
    {
      nomeFile: `IT${CEDENTE}_${chiave}.xml`,
      xmlBase64: Buffer.from(fattura(id)).toString('base64'),
      cedentePartitaIva: CEDENTE,
      firma: false,
      ...extra,
    },
    { 'idempotency-key': chiave }
  )

test('salute senza autenticazione', async () => {
  const f = await avvia()
  const r = await fetch(f.base + '/__salute')
  assert.equal(r.status, 200)
  await f.chiudi()
})

test('senza chiave API valida: 401', async () => {
  const f = await avvia()
  const r = await f.chiama('GET', `/v1/configurazioni/${CEDENTE}`, undefined, {
    authorization: 'Bearer KO',
  })
  assert.equal(r.status, 401)
  const senza = await fetch(f.base + `/v1/configurazioni/${CEDENTE}`)
  assert.equal(senza.status, 401)
  await f.chiudi()
})

test('P.IVA non configurata: lettura 404, invio 422 PIVA_NON_CONFIGURATA', async () => {
  const f = await avvia()
  assert.equal((await f.chiama('GET', `/v1/configurazioni/${CEDENTE}`)).status, 404)
  const r = await invia(f, '12345678901', 'k1')
  assert.equal(r.status, 422)
  assert.equal((await r.json()).codice, 'PIVA_NON_CONFIGURATA')
  await f.chiudi()
})

test('configurazione: formato della P.IVA e dell URL', async () => {
  const f = await avvia()
  assert.equal((await f.chiama('PUT', '/v1/configurazioni/123', { segreto: 'x' })).status, 400)
  assert.equal(
    (
      await f.chiama('PUT', `/v1/configurazioni/${CEDENTE}`, {
        webhookUrl: 'ftp://x',
        segreto: 'x',
      })
    ).status,
    400
  )
  await f.chiudi()
})

test('invio accettato: 201, idempotente sulla stessa chiave, un solo invio registrato', async () => {
  const rx = await ricevitore()
  const f = await configurata(rx.url + '/hook')
  const a = await invia(f, '12345678900', 'k1')
  assert.equal(a.status, 201)
  const ca = await a.json()
  assert.match(ca.idProvider, /^fake-\d+$/)
  const b = await invia(f, '12345678900', 'k1')
  assert.equal(b.status, 201)
  assert.deepEqual(await b.json(), ca)
  assert.equal(f.stato().invii, 1)
  await f.chiudi()
  rx.chiudi()
})

test('la chiave di idempotenza e obbligatoria', async () => {
  const f = await configurata('http://127.0.0.1:1/x')
  const r = await f.chiama('POST', '/v1/fatture', {
    nomeFile: 'a.xml',
    xmlBase64: Buffer.from(fattura('12345678900')).toString('base64'),
    cedentePartitaIva: CEDENTE,
  })
  assert.equal(r.status, 400)
  await f.chiudi()
})

test('webhook RC firmato e verificabile, con il percorso configurato', async () => {
  const rx = await ricevitore()
  const f = await configurata(rx.url + '/sdi/webhook/fake/tok123')
  const r = await invia(f, '12345678900', 'k1')
  const { idProvider } = await r.json()
  await attendi(() => rx.ricevuti.length === 1)
  const w = rx.ricevuti[0]
  assert.equal(w.url, '/sdi/webhook/fake/tok123')
  const esito = verificaFirma(w.intestazioni['x-sdi-signature'], w.corpo, SEGRETO, new Date())
  assert.equal(esito, 'OK')
  assert.equal(
    verificaFirma(w.intestazioni['x-sdi-signature'], w.corpo, 'altro', new Date()),
    'FIRMA'
  )
  const corpo = JSON.parse(w.corpo.toString())
  assert.equal(corpo.idProvider, idProvider)
  assert.equal(corpo.notifica.tipo, 'RC')
  assert.equal(corpo.id, `evt-${corpo.notifica.idNotifica}`)
  await f.chiudi()
  rx.chiudi()
})

test('scenari: NS con 00305; RC + NE EC01 in due eventi', async () => {
  const rx = await ricevitore()
  const f = await configurata(rx.url + '/h')
  await invia(f, '12345678901', 'ns')
  await invia(f, '12345678907', 'ec')
  await attendi(() => rx.ricevuti.length === 3)
  const tipi = rx.ricevuti.map(w => JSON.parse(w.corpo.toString()).notifica)
  assert.deepEqual(
    tipi.map(n => [n.tipo, n.esitoCommittente, n.codiciErrore]).sort(),
    [
      ['NE', 'EC01', []],
      ['NS', null, ['00305']],
      ['RC', null, []],
    ].sort()
  )
  await f.chiudi()
  rx.chiudi()
})

test('RIFIUTATO (5): 422 e nulla registrato; TRANSITORIO (4): 503 con Retry-After', async () => {
  const f = await configurata('http://127.0.0.1:1/x')
  const r5 = await invia(f, '12345678905', 'k5')
  assert.equal(r5.status, 422)
  assert.equal((await r5.json()).codice, 'PIVA_NON_CONFIGURATA')
  const r4 = await invia(f, '12345678904', 'k4')
  assert.equal(r4.status, 503)
  assert.ok(r4.headers.get('retry-after'))
  assert.equal(f.stato().invii, 0)
  await f.chiudi()
})

test('XML senza cessionario: 422 XML_NON_VALIDO', async () => {
  const f = await configurata('http://127.0.0.1:1/x')
  const r = await f.chiama(
    'POST',
    '/v1/fatture',
    {
      nomeFile: 'a.xml',
      xmlBase64: Buffer.from('<x/>').toString('base64'),
      cedentePartitaIva: CEDENTE,
    },
    { 'idempotency-key': 'k' }
  )
  assert.equal(r.status, 422)
  assert.equal((await r.json()).codice, 'XML_NON_VALIDO')
  await f.chiudi()
})

test('INCERTO_ARRIVATO (3): connessione chiusa ma invio registrato e ritrovabile', async () => {
  const f = await configurata('http://127.0.0.1:1/x')
  await assert.rejects(invia(f, '12345678903', 'k3'))
  assert.equal(f.stato().invii, 1)
  const t = await f.chiama('GET', `/v1/fatture?chiaveIdempotenza=k3&nomeFile=x.xml`)
  assert.equal(t.status, 200)
  assert.match((await t.json()).idProvider, /^fake-/)
  await f.chiudi()
})

test('INCERTO_PERSO (6): connessione chiusa, nulla registrato, ricerca 404', async () => {
  const f = await configurata('http://127.0.0.1:1/x')
  await assert.rejects(invia(f, '12345678906', 'k6'))
  assert.equal(f.stato().invii, 0)
  const t = await f.chiama('GET', `/v1/fatture?chiaveIdempotenza=k6&nomeFile=x.xml`)
  assert.equal(t.status, 404)
  await f.chiudi()
})

test('ricerca anche per nome file', async () => {
  const f = await configurata('http://127.0.0.1:1/x')
  await invia(f, '12345678900', 'k1')
  const t = await f.chiama(
    'GET',
    `/v1/fatture?chiaveIdempotenza=altra&nomeFile=IT${CEDENTE}_k1.xml`
  )
  assert.equal(t.status, 200)
  await f.chiudi()
})

test('polling: le notifiche dell invio, 404 se sconosciuto', async () => {
  const f = await configurata('http://127.0.0.1:1/x')
  const { idProvider } = await (await invia(f, '12345678908', 'k8')).json()
  const r = await f.chiama('GET', `/v1/fatture/${idProvider}/notifiche`)
  assert.equal(r.status, 200)
  const n = await r.json()
  assert.deepEqual(
    n.map(x => [x.tipo, x.esitoCommittente]),
    [
      ['RC', null],
      ['NE', 'EC02'],
    ]
  )
  assert.equal((await f.chiama('GET', '/v1/fatture/inesistente/notifiche')).status, 404)
  await f.chiudi()
})

test('consegnaWebhook=false: nessun webhook, il polling funziona (webhook perso)', async () => {
  const rx = await ricevitore()
  const f = await avvia()
  await f.chiama('PUT', `/v1/configurazioni/${CEDENTE}`, {
    webhookUrl: rx.url + '/h',
    segreto: SEGRETO,
    consegnaWebhook: false,
  })
  const { idProvider } = await (await invia(f, '12345678900', 'k1')).json()
  await new Promise(r => setTimeout(r, 100))
  assert.equal(rx.ricevuti.length, 0)
  assert.equal(
    (await (await f.chiama('GET', `/v1/fatture/${idProvider}/notifiche`)).json()).length,
    1
  )
  await f.chiudi()
  rx.chiudi()
})

test('webhook ritentato fino a un 2xx (almeno una volta)', async () => {
  let n = 0
  const ricevuti = []
  const srv = http.createServer((req, res) => {
    n++
    ricevuti.push(req.url)
    res.statusCode = n < 3 ? 500 : 200
    req.resume()
    res.end()
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const f = await configurata(`http://127.0.0.1:${srv.address().port}/h`)
  await invia(f, '12345678900', 'k1')
  await attendi(() => n === 3)
  assert.equal(f.stato().webhookConsegnati, 1)
  await f.chiudi()
  srv.close()
})

test('riconsegna: stesso evento, stesso id (duplicato per provare l idempotenza)', async () => {
  const rx = await ricevitore()
  const f = await configurata(rx.url + '/h')
  const { idProvider } = await (await invia(f, '12345678900', 'k1')).json()
  await attendi(() => rx.ricevuti.length === 1)
  const r = await f.chiama('POST', `/__riconsegna/${idProvider}`)
  assert.equal(r.status, 200)
  await attendi(() => rx.ricevuti.length === 2)
  const id = w => JSON.parse(w.corpo.toString()).id
  assert.equal(id(rx.ricevuti[0]), id(rx.ricevuti[1]))
  await f.chiudi()
  rx.chiudi()
})

test('reset azzera invii e configurazioni', async () => {
  const f = await configurata('http://127.0.0.1:1/x')
  await invia(f, '12345678900', 'k1')
  assert.equal((await f.chiama('POST', '/__reset')).status, 200)
  assert.equal(f.stato().invii, 0)
  assert.equal((await f.chiama('GET', `/v1/configurazioni/${CEDENTE}`)).status, 404)
  await f.chiudi()
})

test('rotta sconosciuta: 404', async () => {
  const f = await avvia()
  assert.equal((await f.chiama('GET', '/v1/boh')).status, 404)
  await f.chiudi()
})
