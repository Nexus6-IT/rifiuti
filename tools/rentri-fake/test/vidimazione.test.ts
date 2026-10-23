import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'
import { validaEfirModel, validaBloccoModel } from '../src/dominio/vidimazione-schema'

// Stesso pattern di `trasmissioni-dati.test.ts`/`dati-registri.test.ts`: un
// jti diverso ad ogni chiamata (anti-replay).
async function tokenValido(): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', x5c: [certificatoBase64Der] } as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience('rentrigov.demo.api')
    .setIssuedAt()
    .setExpirationTime('300s')
    .setJti(randomUUID())
    .sign(chiave)
}

async function intestazioni(): Promise<{ authorization: string }> {
  return { authorization: `Bearer ${await tokenValido()}` }
}

const PREFISSO = '/vidimazione-formulari/v1.0'
const IDENTIFICATIVO = '12345678901'
const CODICE_BLOCCO = 'BLOCCO001'

async function registraBlocco(app: any, codiceBlocco = CODICE_BLOCCO): Promise<void> {
  const risposta = await app.inject({
    method: 'POST',
    url: '/__controllo/vidimazione/blocco',
    payload: { codice_blocco: codiceBlocco, identificativo_soggetto: IDENTIFICATIVO },
  })
  expect(risposta.statusCode).toBe(200)
}

async function vidimaFir(
  app: any,
  codiceBlocco = CODICE_BLOCCO
): Promise<{ transazioneId: string; numeroFir: string; qrCodeBytes: string }> {
  const rispostaPost = await app.inject({
    method: 'POST',
    url: `${PREFISSO}/${codiceBlocco}`,
    headers: await intestazioni(),
  })
  expect(rispostaPost.statusCode).toBe(202)
  const { transazione_id: transazioneId } = rispostaPost.json()
  expect(rispostaPost.headers.location).toBe(`${PREFISSO}/${transazioneId}/status`)

  const completa = await app.inject({
    method: 'POST',
    url: '/__controllo/vidimazione/completa-transazione',
    payload: { transazione_id: transazioneId },
  })
  expect(completa.statusCode).toBe(200)

  const risultato = await app.inject({
    method: 'GET',
    url: `${PREFISSO}/${transazioneId}/result`,
    headers: await intestazioni(),
  })
  expect(risultato.statusCode).toBe(200)
  const corpo = risultato.json()
  return {
    transazioneId,
    numeroFir: corpo.esito.numero_fir,
    qrCodeBytes: corpo.esito.qr_code_bytes,
  }
}

describe('Vidimazione formulari (vidimazione-formulari.yaml v1.0.20260831-1024)', () => {
  describe('GET / (elenco blocchi)', () => {
    it('senza autenticazione: 403 (mai 401)', async () => {
      const app = creaApp()
      const risposta = await app.inject({ method: 'GET', url: `${PREFISSO}/` })
      expect(risposta.statusCode).toBe(403)
      await app.close()
    })

    it('senza identificativo (query obbligatoria): 400', async () => {
      const app = creaApp()
      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(400)
      await app.close()
    })

    it('elenca solo i blocchi del soggetto richiesto, forma BloccoModel', async () => {
      const app = creaApp()
      await registraBlocco(app)

      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/?identificativo=${IDENTIFICATIVO}`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(200)
      const elenco = risposta.json()
      expect(elenco).toHaveLength(1)
      expect(elenco[0].codice_blocco).toBe(CODICE_BLOCCO)
      expect(validaBloccoModel(elenco[0])).toBeNull()
      expect(risposta.headers['paging-totalrecordcount']).toBe('1')

      await app.close()
    })
  })

  describe('POST /{codice_blocco} — vidimazione a blocchi (priorita 1)', () => {
    it('blocco sconosciuto: 404', async () => {
      const app = creaApp()
      const risposta = await app.inject({
        method: 'POST',
        url: `${PREFISSO}/INESISTENTE`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(404)
      await app.close()
    })

    it('vidima un FIR: transazione async 202, poi result con numero_fir e qr_code_bytes Base64', async () => {
      const app = creaApp()
      await registraBlocco(app)

      const { numeroFir, qrCodeBytes } = await vidimaFir(app)

      expect(typeof numeroFir).toBe('string')
      expect(numeroFir).toContain(CODICE_BLOCCO)
      expect(typeof qrCodeBytes).toBe('string')
      // Base64 valido (v. `generaQrCodeBytes`, semplificazione dichiarata:
      // byte plausibili, NON un vero payload CBOR/COSE firmato dall'ente).
      expect(() => Buffer.from(qrCodeBytes, 'base64')).not.toThrow()
      expect(Buffer.from(qrCodeBytes, 'base64').length).toBeGreaterThan(0)

      await app.close()
    })

    it('X-ReplyTo presente: nessun header Location (stesso trattamento di dati-registri/trasmissioni-dati)', async () => {
      const app = creaApp()
      await registraBlocco(app)

      const risposta = await app.inject({
        method: 'POST',
        url: `${PREFISSO}/${CODICE_BLOCCO}`,
        headers: { ...(await intestazioni()), 'x-replyto': 'https://esempio.it/callback' },
      })

      expect(risposta.statusCode).toBe(202)
      expect(risposta.headers.location).toBeUndefined()

      await app.close()
    })

    it('progressivi crescenti su vidimazioni successive dello stesso blocco', async () => {
      const app = creaApp()
      await registraBlocco(app)

      const primo = await vidimaFir(app)
      const secondo = await vidimaFir(app)
      expect(primo.numeroFir).not.toBe(secondo.numeroFir)

      await app.close()
    })
  })

  describe('GET /{codice_blocco} — elenco FIR vidimati', () => {
    it('blocco sconosciuto: 404', async () => {
      const app = creaApp()
      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/INESISTENTE`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(404)
      await app.close()
    })

    it('elenca i FIR vidimati sul blocco, forma EfirModel pubblica', async () => {
      const app = creaApp()
      await registraBlocco(app)
      await vidimaFir(app)

      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/${CODICE_BLOCCO}`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(200)
      const elenco = risposta.json()
      expect(elenco).toHaveLength(1)
      expect(elenco[0]).toHaveProperty('qr_code_bytes')

      await app.close()
    })
  })

  describe('GET /{codice_blocco}/{progressivo} — dati di vidimazione FIR', () => {
    it('FIR inesistente: 404', async () => {
      const app = creaApp()
      await registraBlocco(app)
      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/${CODICE_BLOCCO}/1`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(404)
      await app.close()
    })

    it('dettaglio conforme a EfirModel', async () => {
      const app = creaApp()
      await registraBlocco(app)
      await vidimaFir(app)

      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/${CODICE_BLOCCO}/1`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(200)
      expect(validaEfirModel(risposta.json())).toBeNull()

      await app.close()
    })
  })

  describe('PUT /{codice_blocco}/{progressivo}/annulla', () => {
    it('annulla: 200, is_annullato passa a true; ripetuto: 400 (non reversibile)', async () => {
      const app = creaApp()
      await registraBlocco(app)
      await vidimaFir(app)

      const annulla = await app.inject({
        method: 'PUT',
        url: `${PREFISSO}/${CODICE_BLOCCO}/1/annulla`,
        headers: await intestazioni(),
      })
      expect(annulla.statusCode).toBe(200)

      const dettaglio = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/${CODICE_BLOCCO}/1`,
        headers: await intestazioni(),
      })
      expect(dettaglio.json().is_annullato).toBe(true)

      const ripetuto = await app.inject({
        method: 'PUT',
        url: `${PREFISSO}/${CODICE_BLOCCO}/1/annulla`,
        headers: await intestazioni(),
      })
      expect(ripetuto.statusCode).toBe(400)

      await app.close()
    })

    it('FIR inesistente: 404', async () => {
      const app = creaApp()
      await registraBlocco(app)
      const risposta = await app.inject({
        method: 'PUT',
        url: `${PREFISSO}/${CODICE_BLOCCO}/99/annulla`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(404)
      await app.close()
    })
  })

  describe('GET /{codice_blocco}/{progressivo}/pdf', () => {
    it('DownloadableBaseResponse con content base64', async () => {
      const app = creaApp()
      await registraBlocco(app)
      await vidimaFir(app)

      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/${CODICE_BLOCCO}/1/pdf`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(200)
      const corpo = risposta.json()
      expect(corpo.mime).toBe('application/pdf')
      expect(() => Buffer.from(corpo.content, 'base64')).not.toThrow()

      await app.close()
    })
  })

  describe('GET /verifica/{numero_fir} (priorita 2)', () => {
    it('numero FIR inesistente: 404', async () => {
      const app = creaApp()
      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/verifica/NONESISTE`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(404)
      await app.close()
    })

    it('trova il FIR vidimato per numero, conforme a EfirPublicModel (EfirModel senza campi privati)', async () => {
      const app = creaApp()
      await registraBlocco(app)
      const { numeroFir, qrCodeBytes } = await vidimaFir(app)

      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/verifica/${numeroFir}`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(200)
      const corpo = risposta.json()
      expect(corpo.numero_fir).toBe(numeroFir)
      expect(corpo.qr_code_bytes).toBe(qrCodeBytes)
      expect(corpo).not.toHaveProperty('utente_richiesta')

      await app.close()
    })
  })

  describe('GET /status (stato API)', () => {
    it('risponde Ok', async () => {
      const app = creaApp()
      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/status`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(200)
      expect(risposta.json().status).toBe('Ok')
      await app.close()
    })
  })

  describe('GET /certificati/{certificato_id}', () => {
    it('elenco vuoto (fuori scope dichiarato: nessun certificato reale)', async () => {
      const app = creaApp()
      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/certificati/qualsiasi`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(200)
      expect(risposta.json()).toEqual([])
      await app.close()
    })
  })

  describe('Canale di controllo', () => {
    it('completa-transazione su transazione inesistente: 404', async () => {
      const app = creaApp()
      const risposta = await app.inject({
        method: 'POST',
        url: '/__controllo/vidimazione/completa-transazione',
        payload: { transazione_id: randomUUID() },
      })
      expect(risposta.statusCode).toBe(404)
      await app.close()
    })

    it('azzera svuota blocchi e FIR vidimati', async () => {
      const app = creaApp()
      await registraBlocco(app)
      await vidimaFir(app)

      const azzera = await app.inject({ method: 'POST', url: '/__controllo/vidimazione/azzera' })
      expect(azzera.statusCode).toBe(200)

      const risposta = await app.inject({
        method: 'GET',
        url: `${PREFISSO}/${CODICE_BLOCCO}`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(404)

      await app.close()
    })
  })
})
