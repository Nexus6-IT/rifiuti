import { creaApp } from '../src/app'
import { intestazioniAutenticate } from './aiuti/token'

const P = '/anagrafiche/v1.0'
const SITO_TRASPORTO = 'MI00001234-002' // attivita Trasporto + Recupero, nessuna autorizzazione
const SITO_SEDE = 'MI00001234-001' // attivita Produzione

describe('Registri dell operatore (anagrafiche)', () => {
  const app = creaApp()
  beforeAll(async () => {
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })
  beforeEach(async () => {
    await app.inject({ method: 'POST', url: '/__controllo/azzera' })
  })

  async function chiama(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
    return app.inject({ method, url: `${P}${url}`, headers: await intestazioniAutenticate(), payload: payload as never })
  }
  async function apri(corpo: Record<string, unknown> = { num_iscr_sito: SITO_TRASPORTO, attivita: ['Trasporto'], descrizione: 'Registro prova' }) {
    return chiama('POST', '/operatore/registri', corpo)
  }

  it('senza token ogni rotta risponde 403 problem+json', async () => {
    for (const [method, url] of [
      ['GET', `/operatore/MI00001234/siti/${SITO_SEDE}/registri`],
      ['POST', '/operatore/registri'],
      ['GET', '/operatore/registri/R1234ABCDEF'],
      ['PUT', '/operatore/registri/R1234ABCDEF'],
      ['DELETE', '/operatore/registri/R1234ABCDEF'],
      ['GET', '/operatore/registri/R1234ABCDEF/xml'],
    ] as const) {
      const r = await app.inject({ method, url: `${P}${url}`, payload: method === 'POST' || method === 'PUT' ? {} : undefined })
      expect({ url, stato: r.statusCode }).toEqual({ url, stato: 403 })
      expect(r.headers['content-type']).toContain('application/problem+json')
    }
  })

  describe('POST /operatore/registri', () => {
    it('apre un registro e restituisce 201 con identificativo nel formato del contratto', async () => {
      const r = await apri()
      expect(r.statusCode).toBe(201)
      expect(r.json().identificativo).toMatch(/^R[0-9A-Z]{10}$/)
    })

    it('rifiuta con 400 un corpo non conforme allo schema (campo non previsto, attivita vuota, descrizione lunga)', async () => {
      for (const corpo of [
        { num_iscr_sito: SITO_TRASPORTO, attivita: ['Trasporto'], extra: 1 },
        { num_iscr_sito: SITO_TRASPORTO, attivita: [] },
        { attivita: ['Trasporto'] },
        { num_iscr_sito: SITO_TRASPORTO, attivita: ['Inventata'] },
        { num_iscr_sito: SITO_TRASPORTO, attivita: ['Trasporto'], descrizione: 'x'.repeat(251) },
      ]) {
        const r = await apri(corpo)
        expect({ corpo, stato: r.statusCode }).toEqual({ corpo, stato: 400 })
      }
    })

    it('risponde 404 per un sito inesistente', async () => {
      const r = await apri({ num_iscr_sito: 'NON-ESISTE', attivita: ['Trasporto'] })
      expect(r.statusCode).toBe(404)
    })

    it('rifiuta con 400 attivita non previste dal sito', async () => {
      const r = await apri({ num_iscr_sito: SITO_SEDE, attivita: ['Trasporto'] })
      expect(r.statusCode).toBe(400)
      expect(r.json().detail).toContain('prevista')
    })

    it('Recupero richiede attivita_rec_smalt e i codici devono essere dichiarati dal sito', async () => {
      const senza = await apri({ num_iscr_sito: SITO_TRASPORTO, attivita: ['Recupero'] })
      expect(senza.statusCode).toBe(400)
      const nonDichiarato = await apri({ num_iscr_sito: SITO_TRASPORTO, attivita: ['Recupero'], attivita_rec_smalt: ['R13'] })
      expect(nonDichiarato.statusCode).toBe(400)
      expect(nonDichiarato.json().detail).toContain('R13')
    })

    it('attivita_rec_smalt senza Recupero/Smaltimento e rifiutato', async () => {
      const r = await apri({ num_iscr_sito: SITO_TRASPORTO, attivita: ['Trasporto'], attivita_rec_smalt: ['R13'] })
      expect(r.statusCode).toBe(400)
    })

    it('un guasto iniettato PRIMA dell elaborazione non crea nulla', async () => {
      await app.inject({ method: 'POST', url: '/__controllo/guasto', payload: { stato: 503, volte: 1 } })
      const r = await apri()
      expect(r.statusCode).toBe(503)
      const elenco = await chiama('GET', `/operatore/MI00001234/siti/${SITO_TRASPORTO}/registri`)
      expect(elenco.json()).toEqual([])
    })
  })

  describe('esito perso dopo l elaborazione (canale di controllo)', () => {
    it('5xx: il registro esiste anche se la risposta e un errore', async () => {
      await app.inject({ method: 'POST', url: '/__controllo/registri/esito-perso', payload: { operazione: 'apri', tipo: '5xx', stato: 502 } })
      const r = await apri()
      expect(r.statusCode).toBe(502)
      const elenco = await chiama('GET', `/operatore/MI00001234/siti/${SITO_TRASPORTO}/registri`)
      expect(elenco.json()).toHaveLength(1)
      // un'occorrenza sola: la POST successiva risponde normalmente (e crea un secondo registro)
      expect((await apri()).statusCode).toBe(201)
    })

    it('timeout: nessuna risposta, ma il registro esiste', async () => {
      await app.inject({ method: 'POST', url: '/__controllo/registri/esito-perso', payload: { operazione: 'apri', tipo: 'timeout' } })
      let senzaRisposta = false
      await apri().catch(() => {
        senzaRisposta = true
      })
      expect(senzaRisposta).toBe(true)
      const elenco = await chiama('GET', `/operatore/MI00001234/siti/${SITO_TRASPORTO}/registri`)
      expect(elenco.json()).toHaveLength(1)
    })

    it('rifiuta parametri non validi', async () => {
      const r = await app.inject({ method: 'POST', url: '/__controllo/registri/esito-perso', payload: { operazione: 'boh', tipo: '5xx' } })
      expect(r.statusCode).toBe(400)
    })
  })

  describe('elenco e dettaglio', () => {
    it('elenca solo i registri del sito, con Paging-* coerenti e filtro chiuso', async () => {
      const a = (await apri()).json().identificativo
      await apri()
      await apri({ num_iscr_sito: SITO_SEDE, attivita: ['Produzione'] })
      await chiama('DELETE', `/operatore/registri/${a}`)

      const tutti = await chiama('GET', `/operatore/MI00001234/siti/${SITO_TRASPORTO}/registri`)
      expect(tutti.statusCode).toBe(200)
      expect(tutti.json()).toHaveLength(2)
      expect(tutti.headers['paging-totalrecordcount']).toBe('2')

      const chiusi = await chiama('GET', `/operatore/MI00001234/siti/${SITO_TRASPORTO}/registri?chiuso=true`)
      expect(chiusi.json().map((r: { identificativo: string }) => r.identificativo)).toEqual([a])
      expect(chiusi.json()[0]).toMatchObject({ stato: 'Chiuso', num_iscr_sito: SITO_TRASPORTO })

      const aperti = await chiama('GET', `/operatore/MI00001234/siti/${SITO_TRASPORTO}/registri?chiuso=false`)
      expect(aperti.json()).toHaveLength(1)
      expect(aperti.json()[0].data_chiusura).toBeNull()
    })

    it('applica la paginazione richiesta', async () => {
      for (let i = 0; i < 3; i++) await apri()
      const r = await app.inject({
        method: 'GET',
        url: `${P}/operatore/MI00001234/siti/${SITO_TRASPORTO}/registri`,
        headers: { ...(await intestazioniAutenticate()), 'paging-page': '2', 'paging-pagesize': '2' },
      })
      expect(r.json()).toHaveLength(1)
      expect(r.headers['paging-pagecount']).toBe('2')
    })

    it('elenco: 404 per operatore o sito inesistenti', async () => {
      expect((await chiama('GET', `/operatore/NO/siti/${SITO_SEDE}/registri`)).statusCode).toBe(404)
      expect((await chiama('GET', '/operatore/MI00001234/siti/NO/registri')).statusCode).toBe(404)
    })

    it('dettaglio: RegistroModel completo; 404 se assente', async () => {
      const id = (await apri()).json().identificativo
      const r = await chiama('GET', `/operatore/registri/${id}`)
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({
        identificativo: id,
        descrizione: 'Registro prova',
        num_iscr_sito: SITO_TRASPORTO,
        identificativo_operatore_sito: 'RSSMRA80A01F205X',
        attivita: ['Trasporto'],
        stato: 'Attivo',
        data_chiusura: null,
      })
      expect((await chiama('GET', '/operatore/registri/RZZZZZZZZZZ')).statusCode).toBe(404)
    })
  })

  describe('PUT e DELETE', () => {
    it('modifica la descrizione e valorizza data_modifica', async () => {
      const id = (await apri()).json().identificativo
      const r = await chiama('PUT', `/operatore/registri/${id}`, { descrizione: 'Nuova' })
      expect(r.statusCode).toBe(200)
      expect(r.json()).toEqual({ identificativo: id })
      const d = (await chiama('GET', `/operatore/registri/${id}`)).json()
      expect(d.descrizione).toBe('Nuova')
      expect(d.data_modifica).not.toBeNull()
    })

    it('PUT: 400 su corpo non valido, 404 su registro assente, 400 su registro chiuso', async () => {
      const id = (await apri()).json().identificativo
      expect((await chiama('PUT', `/operatore/registri/${id}`, { descrizione: 'x'.repeat(251) })).statusCode).toBe(400)
      expect((await chiama('PUT', `/operatore/registri/${id}`, { altro: 1 })).statusCode).toBe(400)
      expect((await chiama('PUT', '/operatore/registri/RZZZZZZZZZZ', {})).statusCode).toBe(404)
      await chiama('DELETE', `/operatore/registri/${id}`)
      expect((await chiama('PUT', `/operatore/registri/${id}`, { descrizione: 'tardi' })).statusCode).toBe(400)
    })

    it('PUT attivita_rec_smalt: richiede Recupero/Smaltimento e rispetta forza_salvataggio', async () => {
      const trasporto = (await apri()).json().identificativo
      expect((await chiama('PUT', `/operatore/registri/${trasporto}`, { attivita_rec_smalt: ['R13'] })).statusCode).toBe(400)

      const id = (await app.inject({
        method: 'POST', url: '/__controllo/registri/registro',
        payload: { num_iscr_sito: SITO_TRASPORTO, attivita: ['Recupero'], attivita_rec_smalt: ['R12'] },
      })).json().identificativo
      const senzaForza = await chiama('PUT', `/operatore/registri/${id}`, { attivita_rec_smalt: ['R13'] })
      expect(senzaForza.statusCode).toBe(400)
      const conForza = await chiama('PUT', `/operatore/registri/${id}`, { attivita_rec_smalt: ['R13'], forza_salvataggio_attivita_rec_smalt: true })
      expect(conForza.statusCode).toBe(200)
      expect((await chiama('GET', `/operatore/registri/${id}`)).json().attivita_rec_smalt).toEqual(['R13'])
    })

    it('DELETE chiude, 404 se assente, 400 se gia chiuso', async () => {
      const id = (await apri()).json().identificativo
      const r = await chiama('DELETE', `/operatore/registri/${id}`)
      expect(r.statusCode).toBe(200)
      const d = (await chiama('GET', `/operatore/registri/${id}`)).json()
      expect(d).toMatchObject({ stato: 'Chiuso' })
      expect(d.data_chiusura).not.toBeNull()
      expect((await chiama('DELETE', `/operatore/registri/${id}`)).statusCode).toBe(400)
      expect((await chiama('DELETE', '/operatore/registri/RZZZZZZZZZZ')).statusCode).toBe(404)
    })

    it('esito perso su chiudi/modifica: l operazione e comunque avvenuta', async () => {
      const id = (await apri()).json().identificativo
      await app.inject({ method: 'POST', url: '/__controllo/registri/esito-perso', payload: { operazione: 'chiudi', tipo: '5xx', stato: 504 } })
      expect((await chiama('DELETE', `/operatore/registri/${id}`)).statusCode).toBe(504)
      expect((await chiama('GET', `/operatore/registri/${id}`)).json().stato).toBe('Chiuso')
    })
  })

  describe('GET /operatore/registri/{id}/xml', () => {
    it('restituisce l eREGI in base64 con ds:Signature e Reference #eREGI-CS-0', async () => {
      const id = (await apri()).json().identificativo
      const r = await chiama('GET', `/operatore/registri/${id}/xml`)
      expect(r.statusCode).toBe(200)
      const corpo = r.json()
      expect(corpo.mime).toBe('application/xml')
      expect(corpo.nome_file).toContain(id)
      const xml = Buffer.from(corpo.content, 'base64').toString('utf8')
      expect(xml).toContain('<reg:eREGI ')
      expect(xml).toContain('Id="eREGI-CS-0"')
      expect(xml).toContain(`<reg:Identificativo>${id}</reg:Identificativo>`)
      expect(xml).toContain(`<reg:NumIscrSito>${SITO_TRASPORTO}</reg:NumIscrSito>`)
      expect(xml).toContain('<ds:Reference URI="#eREGI-CS-0">')
      expect(xml).toMatch(/<ds:DigestValue>[A-Za-z0-9+/=]{44}<\/ds:DigestValue>/)
      expect(xml).toContain('<ds:SignatureValue>')
    })

    it('il DigestValue coincide con lo SHA-256 dell eREGI senza firma e la SignatureValue e verificabile', async () => {
      const { createHash, createVerify, X509Certificate } = await import('crypto')
      const id = (await apri()).json().identificativo
      const xml = Buffer.from((await chiama('GET', `/operatore/registri/${id}/xml`)).json().content, 'base64').toString('utf8')
      const senzaFirma = xml.replace('<?xml version="1.0" encoding="UTF-8"?>', '').replace(/<ds:Signature>[\s\S]*<\/ds:Signature>/, '')
      const digest = createHash('sha256').update(senzaFirma, 'utf8').digest('base64')
      expect(xml).toContain(`<ds:DigestValue>${digest}</ds:DigestValue>`)

      const signedInfo = /<ds:SignedInfo>[\s\S]*<\/ds:SignedInfo>/.exec(xml)![0]
      const valore = /<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/.exec(xml)![1]
      const cert = /<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/.exec(xml)![1]
      const chiave = new X509Certificate(Buffer.from(cert, 'base64')).publicKey
      expect(createVerify('sha256').update(signedInfo, 'utf8').verify(chiave, valore, 'base64')).toBe(true)
    })

    it('404 per registro assente', async () => {
      expect((await chiama('GET', '/operatore/registri/RZZZZZZZZZZ/xml')).statusCode).toBe(404)
    })
  })

  it('canale di controllo registro: popola un registro gia esistente, anche chiuso, con identificativo scelto', async () => {
    const r = await app.inject({
      method: 'POST', url: '/__controllo/registri/registro',
      payload: { num_iscr_sito: SITO_SEDE, attivita: ['Produzione'], identificativo: 'RABCDE12345', chiuso: true },
    })
    expect(r.json()).toEqual({ identificativo: 'RABCDE12345' })
    expect((await chiama('GET', '/operatore/registri/RABCDE12345')).json().stato).toBe('Chiuso')
  })

  it('azzera svuota i registri', async () => {
    await apri()
    await app.inject({ method: 'POST', url: '/__controllo/azzera' })
    expect((await chiama('GET', `/operatore/MI00001234/siti/${SITO_TRASPORTO}/registri`)).json()).toEqual([])
  })
})
