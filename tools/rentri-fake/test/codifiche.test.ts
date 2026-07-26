import { creaApp } from '../src/app'
import { intestazioniAutenticate } from './aiuti/token'

// Task 1 di R4 (docs/superpowers/plans/2026-07-26-r4-anagrafiche-codifiche.md):
// l'oracolo impara a rispondere anche su `codifiche` (25 path, tutti GET,
// nessuna scrittura). Un test per regola: un caso che passa, uno respinto.
describe('Rotte codifiche', () => {
  it('rifiuta con 403 una lookup senza token', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/codifiche/v1.0/lookup/codici-eer' })

    expect(risposta.statusCode).toBe(403)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('restituisce i codici EER nella forma Int16LookupModel (id/code/name/properties)', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/codifiche/v1.0/lookup/codici-eer',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(Array.isArray(corpo)).toBe(true)
    expect(corpo.length).toBeGreaterThan(0)
    expect(corpo[0]).toEqual(
      expect.objectContaining({
        id: expect.anything(),
        code: expect.anything(),
        name: expect.anything(),
      })
    )
    // Un codice pericoloso e uno non pericoloso, come richiesto dal piano.
    expect(
      corpo.some((c: { properties: { pericoloso: boolean } }) => c.properties.pericoloso === true)
    ).toBe(true)
    expect(
      corpo.some((c: { properties: { pericoloso: boolean } }) => c.properties.pericoloso === false)
    ).toBe(true)

    await app.close()
  })

  it('filtra i codici EER con pericoloso=true, escludendo i non pericolosi', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/codifiche/v1.0/lookup/codici-eer?pericoloso=true',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(corpo.length).toBeGreaterThan(0)
    expect(
      corpo.every((c: { properties: { pericoloso: boolean } }) => c.properties.pericoloso === true)
    ).toBe(true)

    await app.close()
  })

  it('escludi00=true esclude le voci di capitolo dai codici EER', async () => {
    const app = creaApp()

    const conCapitolo = await app.inject({
      method: 'GET',
      url: '/codifiche/v1.0/lookup/codici-eer',
      headers: await intestazioniAutenticate(),
    })
    expect(conCapitolo.json().some((c: { code: string }) => c.code === '130000')).toBe(true)

    const senzaCapitolo = await app.inject({
      method: 'GET',
      url: '/codifiche/v1.0/lookup/codici-eer?escludi00=true',
      headers: await intestazioniAutenticate(),
    })
    expect(senzaCapitolo.json().some((c: { code: string }) => c.code === '130000')).toBe(false)

    await app.close()
  })

  it("attivita-rs include almeno un'operazione R e una D", async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/codifiche/v1.0/lookup/attivita-rs',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(corpo.some((a: { code: string }) => a.code.startsWith('R'))).toBe(true)
    expect(corpo.some((a: { code: string }) => a.code.startsWith('D'))).toBe(true)

    await app.close()
  })

  it('rifiuta con 403 le rotte di lookup meno frequentate senza token (non solo codici-eer)', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/codifiche/v1.0/lookup/adr-classi' })

    expect(risposta.statusCode).toBe(403)

    await app.close()
  })

  it('restituisce il catalogo comuni includendo un comune non più attivo (fusione comunale)', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/codifiche/v1.0/lookup/comuni',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    const soppresso = corpo.find(
      (c: { properties: { attivo: boolean } }) => c.properties.attivo === false
    )
    expect(soppresso).toBeDefined()
    expect(soppresso.properties['nuovo-id']).not.toBeNull()
    expect(soppresso.properties['fine-validita']).not.toBeNull()

    await app.close()
  })

  it('/lookup/comuni/{provincia_id} con attivi=true (default) esclude il comune soppresso di quella provincia', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      // Provincia di Firenze nella fixture: contiene sia il comune
      // soppresso (San Piero a Sieve) sia il comune che lo ha assorbito.
      url: '/codifiche/v1.0/lookup/comuni/048',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(
      corpo.every((c: { properties: { attivo: boolean } }) => c.properties.attivo === true)
    ).toBe(true)
    expect(corpo.some((c: { name: string }) => c.name === 'Scarperia e San Piero')).toBe(true)

    await app.close()
  })

  it('/lookup/comuni/{provincia_id}?attivi=false restituisce anche il comune soppresso', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/codifiche/v1.0/lookup/comuni/048?attivi=false',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(corpo.some((c: { name: string }) => c.name === 'San Piero a Sieve')).toBe(true)

    await app.close()
  })

  it('/status non richiede autenticazione ed espone lo stato Ok', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/codifiche/v1.0/status' })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toMatchObject({ status: 'Ok' })

    await app.close()
  })

  // Punto 8 (v. controllo.test.ts): il guasto iniettato dal canale di
  // controllo si applica anche alle nuove rotte, non solo a `formulari`.
  it('propaga un 429 con Retry-After iniettato dal canale di controllo', async () => {
    const app = creaApp()

    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 429, volte: 1 },
    })

    const risposta = await app.inject({
      method: 'GET',
      url: '/codifiche/v1.0/lookup/materiali',
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
      url: '/codifiche/v1.0/lookup/province',
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(423)

    await app.close()
  })
})
