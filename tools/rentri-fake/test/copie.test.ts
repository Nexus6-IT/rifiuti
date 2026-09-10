import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

// Stesso schema anti-replay di trasmissioni-dati.test.ts/transazioni.test.ts:
// un jti diverso ad ogni chiamata.
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

const NUMERO_FIR = 'TSTB12345XY'
const NUM_ISCR_SITO_DESTINATARIO = 'OP1234ABC000002-AB0002'
const NUM_ISCR_SITO_ALTRO = 'OP9999XYZ000009-ZZ9999'
const PRODUTTORE_CF = 'RSSMRA80A01F205X'

/** Corpo valido secondo `CopiaDigitaleModel` (formulari.yaml righe 6672-6690). */
function corpoCopiaDigitaleValida(
  sovrascritture?: Record<string, unknown>
): Record<string, unknown> {
  return {
    num_iscr_sito: NUM_ISCR_SITO_DESTINATARIO,
    xfir: Buffer.from('contenuto-xfir-di-prova').toString('base64'),
    ...(sovrascritture ?? {}),
  }
}

/** Corpo valido secondo `CopiaCartaceaModel` (formulari.yaml righe 6381-6439). */
function corpoCopiaCartaceaValida(
  sovrascritture?: Record<string, unknown>
): Record<string, unknown> {
  return {
    numero_fir: NUMERO_FIR,
    data_emissione: '2026-09-01T10:00:00Z',
    file_content: Buffer.from('contenuto-pdf-di-prova').toString('base64'),
    nome_file: 'copia-fir.pdf',
    mime: 'application/pdf',
    produttore: { codice_fiscale: PRODUTTORE_CF, denominazione: 'Produttore Ambiente S.r.l.' },
    ...(sovrascritture ?? {}),
  }
}

async function seminaFormularioConProduttore(app: any, produttore: string): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/__controllo/formulario',
    payload: { numero_fir: NUMERO_FIR, stato: 'Accettato', produttore },
  })
}

describe('Copia FIR digitale (formulari.yaml righe 3628-4451)', () => {
  describe('POST /copia-digitale/caricamento/{numero_fir}', () => {
    it('accetta la richiesta: 202, TransazioneModel con transazione_id uuid, header Location', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })

      expect(risposta.statusCode).toBe(202)
      const corpo = risposta.json()
      expect(corpo.transazione_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
      expect(risposta.headers.location).toBe(`/formulari/v1.0/${corpo.transazione_id}/status`)

      await app.close()
    })

    it('rifiuta un numero_fir mal formato: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: '/formulari/v1.0/copia-digitale/caricamento/non-un-fir',
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })

    it('rifiuta un corpo privo di xfir: 400 problem+json', async () => {
      const app = creaApp()
      const corpo = corpoCopiaDigitaleValida()
      delete (corpo as Record<string, unknown>).xfir

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpo,
      })

      expect(risposta.statusCode).toBe(400)
      expect(risposta.headers['content-type']).toContain('application/problem+json')

      await app.close()
    })

    it('rifiuta un num_iscr_sito mal formato nel corpo: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida({ num_iscr_sito: 'non-valido' }),
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })

    it('rifiuta senza autenticazione: 403 (mai 401)', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        payload: corpoCopiaDigitaleValida(),
      })

      expect(risposta.statusCode).toBe(403)

      await app.close()
    })

    it('la copia e subito consultabile dall elenco del destinatario, prima ancora che la transazione sia completata', async () => {
      const app = creaApp()

      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })

      const elenco = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUM_ISCR_SITO_DESTINATARIO}`,
        headers: await intestazioni(),
      })

      expect(elenco.statusCode).toBe(200)
      const risultati = elenco.json()
      expect(risultati).toHaveLength(1)
      expect(risultati[0].numero_fir).toBe(NUMERO_FIR)
      expect(elenco.headers['paging-totalrecordcount']).toBe('1')

      await app.close()
    })
  })

  describe('GET /copia-digitale/caricamento/{num_iscr_sito}/{identificativo}', () => {
    it('legge il dettaglio appena creato', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUM_ISCR_SITO_DESTINATARIO}/${identificativo}`,
        headers: await intestazioni(),
      })

      expect(dettaglio.statusCode).toBe(200)
      const corpo = dettaglio.json()
      expect(corpo.identificativo).toBe(identificativo)
      expect(corpo.numero_fir).toBe(NUMERO_FIR)
      expect(corpo.num_iscr_sito).toBe(NUM_ISCR_SITO_DESTINATARIO)

      await app.close()
    })

    it('risponde 404 per un identificativo inesistente', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUM_ISCR_SITO_DESTINATARIO}/${randomUUID()}`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(404)

      await app.close()
    })

    it('risponde 404 se la copia esiste ma per un num_iscr_sito diverso (confine di visibilita)', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUM_ISCR_SITO_ALTRO}/${identificativo}`,
        headers: await intestazioni(),
      })

      expect(dettaglio.statusCode).toBe(404)

      await app.close()
    })

    it('rifiuta un num_iscr_sito mal formato: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/caricamento/non-valido/${randomUUID()}`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })
  })

  describe('GET /copia-digitale/caricamento/{num_iscr_sito}/{identificativo}/documento', () => {
    it('restituisce il contenuto xfir caricato', async () => {
      const app = creaApp()
      const xfir = Buffer.from('contenuto-xfir-unico').toString('base64')

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida({ xfir }),
      })
      const { transazione_id: identificativo } = invio.json()

      const documento = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUM_ISCR_SITO_DESTINATARIO}/${identificativo}/documento`,
        headers: await intestazioni(),
      })

      expect(documento.statusCode).toBe(200)
      expect(documento.json().content).toBe(xfir)

      await app.close()
    })
  })

  describe('DELETE /copia-digitale/caricamento/{num_iscr_sito}/{identificativo}', () => {
    it('cancella una copia non ancora confermata: 204', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      const cancella = await app.inject({
        method: 'DELETE',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUM_ISCR_SITO_DESTINATARIO}/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(cancella.statusCode).toBe(204)

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUM_ISCR_SITO_DESTINATARIO}/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(dettaglio.statusCode).toBe(404)

      await app.close()
    })

    it('rifiuta la cancellazione di una copia gia confermata: 400', async () => {
      const app = creaApp()
      await seminaFormularioConProduttore(app, PRODUTTORE_CF)

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-digitale/conferma/OP0000AAA000000-AA0000/${identificativo}`,
        headers: await intestazioni(),
      })

      const cancella = await app.inject({
        method: 'DELETE',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUM_ISCR_SITO_DESTINATARIO}/${identificativo}`,
        headers: await intestazioni(),
      })

      expect(cancella.statusCode).toBe(400)
      expect(cancella.headers['content-type']).toContain('application/problem+json')

      await app.close()
    })
  })

  describe('GET /copia-digitale/conferma/{identificativo_soggetto} e conferma PUT', () => {
    it('elenca le copie disponibili per il produttore risolto dal formulario sottostante', async () => {
      const app = creaApp()
      await seminaFormularioConProduttore(app, PRODUTTORE_CF)

      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })

      const elenco = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/conferma/${PRODUTTORE_CF}`,
        headers: await intestazioni(),
      })

      expect(elenco.statusCode).toBe(200)
      const risultati = elenco.json()
      expect(risultati).toHaveLength(1)
      expect(risultati[0].numero_fir).toBe(NUMERO_FIR)
      expect(risultati[0].is_confermata).toBe(false)

      await app.close()
    })

    it('senza un formulario seminato la copia non compare per alcun soggetto (divergenza dichiarata)', async () => {
      const app = creaApp()

      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })

      const elenco = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/conferma/${PRODUTTORE_CF}`,
        headers: await intestazioni(),
      })

      expect(elenco.json()).toHaveLength(0)

      await app.close()
    })

    it('PUT conferma: 204, e la copia risulta confermata nell elenco per soggetto', async () => {
      const app = creaApp()
      await seminaFormularioConProduttore(app, PRODUTTORE_CF)

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      const conferma = await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-digitale/conferma/OP0000AAA000000-AA0000/${identificativo}?ruolo=Produttore`,
        headers: await intestazioni(),
      })
      expect(conferma.statusCode).toBe(204)

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/conferma/${PRODUTTORE_CF}/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(dettaglio.statusCode).toBe(200)
      expect(dettaglio.json().produttore.data_conferma).not.toBeNull()

      await app.close()
    })

    it('PUT con respingi=true annulla la conferma precedente', async () => {
      const app = creaApp()
      await seminaFormularioConProduttore(app, PRODUTTORE_CF)

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-digitale/conferma/OP0000AAA000000-AA0000/${identificativo}`,
        headers: await intestazioni(),
      })
      await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-digitale/conferma/OP0000AAA000000-AA0000/${identificativo}?respingi=true`,
        headers: await intestazioni(),
      })

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/conferma/${PRODUTTORE_CF}/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(dettaglio.json().produttore.data_conferma).toBeNull()

      await app.close()
    })

    it('PUT conferma risponde 404 per un identificativo inesistente', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-digitale/conferma/OP0000AAA000000-AA0000/${randomUUID()}`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(404)

      await app.close()
    })
  })

  // Ciclo NONBLOCK_PULL: come /trasmissioni/operatore/.../estrai, riusa i
  // path canonici /status e /result senza reimplementarli — v. anche i path
  // DEPRECATI equivalenti sotto /copia-digitale/, testati subito dopo.
  describe('ciclo asincrono (status/result canonici e deprecati)', () => {
    it('il ciclo si completa tramite i path canonici /formulari/v1.0/{id}/status e /result', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })
      const { transazione_id: transazioneId } = invio.json()

      const statoPrima = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoPrima.statusCode).toBe(200)
      expect(statoPrima.body).toBe('')

      await app.inject({
        method: 'POST',
        url: '/__controllo/completa-transazione',
        payload: { transazione_id: transazioneId, errore: false, validazione: [] },
      })

      const statoDopo = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoDopo.statusCode).toBe(303)
      expect(statoDopo.headers.location).toBe(`/formulari/v1.0/${transazioneId}/result`)

      const risultato = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/${transazioneId}/result`,
        headers: await intestazioni(),
      })
      expect(risultato.statusCode).toBe(200)
      expect(risultato.json().errore).toBe(false)

      await app.close()
    })

    it('i path deprecati /copia-digitale/{id}/status e /result rispondono con lo stesso ciclo', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-digitale/caricamento/${NUMERO_FIR}`,
        headers: await intestazioni(),
        payload: corpoCopiaDigitaleValida(),
      })
      const { transazione_id: transazioneId } = invio.json()

      const statoPrima = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoPrima.statusCode).toBe(200)

      await app.inject({
        method: 'POST',
        url: '/__controllo/completa-transazione',
        payload: { transazione_id: transazioneId, errore: false, validazione: [] },
      })

      const statoDopo = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoDopo.statusCode).toBe(303)
      expect(statoDopo.headers.location).toBe(
        `/formulari/v1.0/copia-digitale/${transazioneId}/result`
      )

      const risultato = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-digitale/${transazioneId}/result`,
        headers: await intestazioni(),
      })
      expect(risultato.statusCode).toBe(200)
      expect(risultato.json().errore).toBe(false)

      await app.close()
    })
  })
})

describe('Copia FIR cartaceo (formulari.yaml righe 2898-3627)', () => {
  const NUM_ISCR_SITO_TRASPORTATORE = 'OP1234ABC000003-AB0003'

  describe('POST /copia-cartacea/caricamento/{num_iscr_sito}', () => {
    it('accetta la richiesta: 202, TransazioneModel con transazione_id uuid, header Location', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })

      expect(risposta.statusCode).toBe(202)
      const corpo = risposta.json()
      expect(corpo.transazione_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
      expect(risposta.headers.location).toBe(`/formulari/v1.0/${corpo.transazione_id}/status`)

      await app.close()
    })

    it('rifiuta un num_iscr_sito mal formato: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: '/formulari/v1.0/copia-cartacea/caricamento/non-valido',
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })

    it('rifiuta un corpo privo di produttore: 400 problem+json', async () => {
      const app = creaApp()
      const corpo = corpoCopiaCartaceaValida()
      delete (corpo as Record<string, unknown>).produttore

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpo,
      })

      expect(risposta.statusCode).toBe(400)
      expect(risposta.headers['content-type']).toContain('application/problem+json')

      await app.close()
    })

    it('rifiuta senza autenticazione: 403', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        payload: corpoCopiaCartaceaValida(),
      })

      expect(risposta.statusCode).toBe(403)

      await app.close()
    })
  })

  describe('elenco/dettaglio/documento', () => {
    it('elenca le copie caricate dal trasportatore, con gli header di paginazione', async () => {
      const app = creaApp()

      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })

      const elenco = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
      })

      expect(elenco.statusCode).toBe(200)
      const risultati = elenco.json()
      expect(risultati).toHaveLength(1)
      expect(risultati[0].produttore.codice_fiscale).toBe(PRODUTTORE_CF)
      expect(elenco.headers['paging-totalrecordcount']).toBe('1')

      await app.close()
    })

    it('legge il dettaglio e il documento appena caricati', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(dettaglio.statusCode).toBe(200)
      expect(dettaglio.json().numero_fir).toBe(NUMERO_FIR)

      const documento = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}/${identificativo}/documento`,
        headers: await intestazioni(),
      })
      expect(documento.statusCode).toBe(200)
      expect(documento.json().nome_file).toBe('copia-fir.pdf')

      await app.close()
    })

    it('risponde 404 per un identificativo inesistente', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}/${randomUUID()}`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(404)

      await app.close()
    })
  })

  describe('DELETE /copia-cartacea/caricamento/{num_iscr_sito}/{identificativo}', () => {
    it('cancella una copia non confermata: 204', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      const cancella = await app.inject({
        method: 'DELETE',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(cancella.statusCode).toBe(204)

      await app.close()
    })

    it('rifiuta la cancellazione di una copia gia confermata: 400', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-cartacea/conferma/${PRODUTTORE_CF}`,
        headers: await intestazioni(),
        payload: { identificativo },
      })

      const cancella = await app.inject({
        method: 'DELETE',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}/${identificativo}`,
        headers: await intestazioni(),
      })

      expect(cancella.statusCode).toBe(400)

      await app.close()
    })
  })

  describe('GET/PUT /copia-cartacea/conferma/{identificativo_soggetto}', () => {
    it('elenca le copie disponibili per il produttore dichiarato nel corpo', async () => {
      const app = creaApp()

      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })

      const elenco = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/conferma/${PRODUTTORE_CF}`,
        headers: await intestazioni(),
      })

      expect(elenco.statusCode).toBe(200)
      expect(elenco.json()).toHaveLength(1)

      await app.close()
    })

    it('un soggetto non coinvolto non vede la copia (confine di visibilita)', async () => {
      const app = creaApp()

      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })

      const elenco = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/conferma/UNALTROCF00X000Y`,
        headers: await intestazioni(),
      })

      expect(elenco.json()).toHaveLength(0)

      await app.close()
    })

    it('PUT conferma: 204, poi il dettaglio del produttore riporta data_conferma valorizzata', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      const conferma = await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-cartacea/conferma/${PRODUTTORE_CF}`,
        headers: await intestazioni(),
        payload: { identificativo, ruolo: 'Produttore' },
      })
      expect(conferma.statusCode).toBe(204)

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/conferma/${PRODUTTORE_CF}/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(dettaglio.statusCode).toBe(200)
      expect(dettaglio.json().produttore.data_conferma).not.toBeNull()

      await app.close()
    })

    it('PUT conferma per un soggetto non pertinente: 404 (mai una rivelazione)', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })
      const { transazione_id: identificativo } = invio.json()

      const conferma = await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-cartacea/conferma/UNALTROCF00X000Y`,
        headers: await intestazioni(),
        payload: { identificativo },
      })

      expect(conferma.statusCode).toBe(404)

      await app.close()
    })

    it('PUT conferma rifiuta un corpo senza identificativo: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'PUT',
        url: `/formulari/v1.0/copia-cartacea/conferma/${PRODUTTORE_CF}`,
        headers: await intestazioni(),
        payload: {},
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })
  })

  describe('ciclo asincrono deprecato /copia-cartacea/{id}/status e /result', () => {
    it('attraversa lo stesso ciclo NONBLOCK_PULL dei path canonici', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/copia-cartacea/caricamento/${NUM_ISCR_SITO_TRASPORTATORE}`,
        headers: await intestazioni(),
        payload: corpoCopiaCartaceaValida(),
      })
      const { transazione_id: transazioneId } = invio.json()

      const statoPrima = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoPrima.statusCode).toBe(200)

      await app.inject({
        method: 'POST',
        url: '/__controllo/completa-transazione',
        payload: { transazione_id: transazioneId, errore: false, validazione: [] },
      })

      const statoDopo = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoDopo.statusCode).toBe(303)

      const risultato = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/copia-cartacea/${transazioneId}/result`,
        headers: await intestazioni(),
      })
      expect(risultato.statusCode).toBe(200)
      expect(risultato.json().errore).toBe(false)

      await app.close()
    })
  })
})
