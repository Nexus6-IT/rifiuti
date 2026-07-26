import { creaApp } from '../src/app'
import { intestazioniAutenticate } from './aiuti/token'

// Task 1 di R4: l'oracolo impara a rispondere anche su `anagrafiche` (solo i
// path di lettura su Operatore/Soggetto delegato — i `/registri` restano
// fuori dall'ambito). Un test per regola: un caso che passa, uno respinto.
describe('Rotte anagrafiche', () => {
  it("rifiuta con 403 l'elenco unità locali senza token", async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/MI00001234/siti',
    })

    expect(risposta.statusCode).toBe(403)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it("elenca le unità locali dell'operatore con gli header Paging-*", async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/MI00001234/siti',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(Array.isArray(corpo)).toBe(true)
    expect(corpo.length).toBe(2)
    expect(corpo.map((s: { num_iscr_sito: string }) => s.num_iscr_sito)).toContain('MI00001234-001')
    expect(risposta.headers['paging-page']).toBeDefined()
    expect(risposta.headers['paging-pagesize']).toBeDefined()
    expect(risposta.headers['paging-pagecount']).toBeDefined()
    expect(risposta.headers['paging-totalrecordcount']).toBeDefined()

    await app.close()
  })

  it('risponde 404 per un operatore inesistente su /siti', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/NON-ESISTE/siti',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(404)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it("ottiene il dettaglio di un'unità locale (SitoModel)", async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/MI00001234/siti/MI00001234-001',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toMatchObject({
      num_iscr_sito: 'MI00001234-001',
      is_sede_legale: true,
      comune_id: '015146',
      stato: 'Attivo',
    })

    await app.close()
  })

  it('risponde 404 per un num_iscr_sito inesistente sotto un operatore valido', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/MI00001234/siti/NON-ESISTE',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })

  it("ottiene le autorizzazioni dell'unità locale (AutRecerModel)", async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/MI00001234/siti/MI00001234-001/autorizzazioni',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(corpo.length).toBeGreaterThan(0)
    expect(corpo[0]).toMatchObject({ tipo_autorizzazione: 'RecProcSemplificata' })

    await app.close()
  })

  it('controllo-iscrizione restituisce true per un codice fiscale iscritto', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/RSSMRA80A01F205X/controllo-iscrizione',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toBe(true)

    await app.close()
  })

  it('controllo-iscrizione restituisce false per un codice fiscale non iscritto', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/CFINESISTENTE00X/controllo-iscrizione',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toBe(false)

    await app.close()
  })

  it("ottiene i dati dell'autorizzazione Albo dell'operatore", async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore/MI00001234/autorizzazione-albo',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toMatchObject({ attiva: true, numero_iscrizione: 12345 })

    await app.close()
  })

  it('elenca le unità locali per cui un soggetto delegato ha delega', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/soggetto-delegato/MI00009999/siti',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(corpo.length).toBe(1)
    expect(corpo[0].num_iscr_sito).toBe('MI00001234-001')

    await app.close()
  })

  it('risponde 404 per un soggetto delegato inesistente', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/soggetto-delegato/NON-ESISTE/siti',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })

  it('/status non richiede autenticazione', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/anagrafiche/v1.0/status' })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toMatchObject({ status: 'Ok' })

    await app.close()
  })

  it('propaga un 429 con Retry-After iniettato dal canale di controllo', async () => {
    const app = creaApp()

    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 429, volte: 1 },
    })

    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/operatore',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(429)
    expect(risposta.headers['retry-after']).toBeDefined()

    await app.close()
  })

  it('propaga un 423 (ban del chiamante) iniettato dal canale di controllo', async () => {
    const app = creaApp()

    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 423, volte: 1 },
    })

    const risposta = await app.inject({
      method: 'GET',
      url: '/anagrafiche/v1.0/soggetto-delegato',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(423)

    await app.close()
  })
})
