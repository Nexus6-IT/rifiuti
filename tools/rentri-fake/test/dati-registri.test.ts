import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

// Un jti diverso ad ogni chiamata (FEDELTA.md §5.2 punto 3, anti-replay): v.
// lo stesso commento in transazioni.test.ts/trasmissioni-dati.test.ts.
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

const REGISTRO = 'R1234ABCDEF'
const REGISTRO_ALTRO = 'R9999ZZZZZZ'

function movimentoValido(anno: number, progressivo: number): Record<string, unknown> {
  return {
    riferimenti: {
      numero_registrazione: { anno, progressivo },
      data_ora_registrazione: '2026-01-10T08:00:00Z',
      causale_operazione: 'DT',
    },
    rifiuto: {
      codice_eer: '200101',
      stato_fisico: 'S',
      quantita: { valore: 10, unita_misura: 'kg' },
    },
    produttore: {
      denominazione: 'Produttore di prova',
      indirizzo: {
        citta: { comune_id: '058091' },
        indirizzo: 'Via di prova 1',
      },
    },
  }
}

async function registraRegistro(app: any, identificativoRegistro = REGISTRO): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/__controllo/dati-registri/registro',
    payload: { identificativo_registro: identificativoRegistro },
  })
}

async function completaTransazione(
  app: any,
  transazioneId: string,
  extra: Record<string, unknown> = {}
) {
  return app.inject({
    method: 'POST',
    url: '/__controllo/dati-registri/completa-transazione',
    payload: { transazione_id: transazioneId, errore: false, validazione: [], ...extra },
  })
}

describe('Canale di controllo: ultima transazione', () => {
  it('restituisce l\'id dell\'ultima transazione Movimenti, 404 se non ce ne sono', async () => {
    const app = creaApp()
    await registraRegistro(app)
    const url = `/__controllo/dati-registri/ultima-transazione/${REGISTRO}`

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404)

    const invio = await app.inject({
      method: 'POST',
      url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
      headers: await intestazioni(),
      payload: [movimentoValido(2026, 1)],
    })
    const risposta = await app.inject({ method: 'GET', url })
    expect(risposta.statusCode).toBe(200)
    expect(risposta.json().transazione_id).toBe(invio.json().transazione_id)

    await app.close()
  })
})

describe('Servizio dati-registri (dati-registri.yaml)', () => {
  describe('POST /operatore/{identificativo_registro}/movimenti', () => {
    it('accetta la richiesta: 202, TransazioneModel, header Location verso lo status', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })

      expect(risposta.statusCode).toBe(202)
      const corpo = risposta.json()
      expect(corpo.transazione_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
      expect(risposta.headers.location).toBe(`/dati-registri/v1.0/${corpo.transazione_id}/status`)

      await app.close()
    })

    it('rifiuta senza autenticazione: 403 (mai 401)', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        payload: [movimentoValido(2026, 1)],
      })

      expect(risposta.statusCode).toBe(403)
      await app.close()
    })

    it('rifiuta un identificativo_registro mal formato: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: '/dati-registri/v1.0/operatore/non-valido/movimenti',
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })

      expect(risposta.statusCode).toBe(400)
      await app.close()
    })

    it('risponde 404 se il registro non e mai stato aperto (canale di controllo)', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })

      expect(risposta.statusCode).toBe(404)
      await app.close()
    })

    it('rifiuta un corpo che non rispetta MovimentoModel: 400 problem+json', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [{}],
      })

      expect(risposta.statusCode).toBe(400)
      expect(risposta.headers['content-type']).toContain('application/problem+json')
      await app.close()
    })

    it('rifiuta un array vuoto: 400', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [],
      })

      expect(risposta.statusCode).toBe(400)
      await app.close()
    })

    it('accetta un AnnullamentoMovimentoModel (oneOf)', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [
          {
            numero_registrazione: { anno: 2026, progressivo: 2 },
            numero_registrazione_annullata: { anno: 2026, progressivo: 1 },
            data_ora_registrazione: '2026-01-11T08:00:00Z',
            annotazioni: 'Errore di battitura',
          },
        ],
      })

      expect(risposta.statusCode).toBe(202)
      await app.close()
    })
  })

  // Ciclo NONBLOCK_PULL: /status risponde 200 finche' in elaborazione, poi
  // 303 -> /result; il completamento arriva solo dal canale di controllo
  // dedicato (`/__controllo/dati-registri/completa-transazione`, stato
  // separato da quello di `formulari.ts`).
  describe('ciclo /status -> /result', () => {
    it('applica DAVVERO la registrazione al completamento con successo, leggibile poi da GET /movimento/{anno}/{progressivo}', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const invio = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })
      const { transazione_id: transazioneId } = invio.json()

      const statoPrima = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoPrima.statusCode).toBe(200)
      expect(statoPrima.body).toBe('')

      await completaTransazione(app, transazioneId)

      const statoDopo = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoDopo.statusCode).toBe(303)
      expect(statoDopo.headers.location).toBe(`/dati-registri/v1.0/${transazioneId}/result`)

      const risultato = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/${transazioneId}/result`,
        headers: await intestazioni(),
      })
      expect(risultato.statusCode).toBe(200)
      const corpoRisultato = risultato.json()
      expect(corpoRisultato.errore).toBe(false)
      expect(corpoRisultato.esito.numero_registrazioni).toHaveLength(1)
      const identificativo = corpoRisultato.esito.numero_registrazioni[0].identificativo
      expect(identificativo).toMatch(/^M[0-9A-Z]{19}$/)

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimento/2026/1`,
        headers: await intestazioni(),
      })
      expect(dettaglio.statusCode).toBe(200)
      const corpoDettaglio = dettaglio.json()
      expect(corpoDettaglio.riferimenti.numero_registrazione.identificativo).toBe(identificativo)
      expect(corpoDettaglio.rifiuto.codice_eer).toBe('200101')
      expect(corpoDettaglio.annullato).toBe(false)

      const dettaglioPerId = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimento/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(dettaglioPerId.statusCode).toBe(200)
      expect(dettaglioPerId.json().riferimenti.numero_registrazione.anno).toBe(2026)

      await app.close()
    })

    it('/result risponde 400 problem+json se la transazione non e ancora elaborata', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const invio = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })
      const { transazione_id: transazioneId } = invio.json()

      const risultato = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/${transazioneId}/result`,
        headers: await intestazioni(),
      })
      expect(risultato.statusCode).toBe(400)
      expect(risultato.headers['content-type']).toContain('application/problem+json')

      await app.close()
    })

    it('non applica la registrazione se il completamento segnala errore', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const invio = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })
      const { transazione_id: transazioneId } = invio.json()

      await completaTransazione(app, transazioneId, {
        errore: true,
        validazione: [{ tipo: 'Errore', codice_messaggio: 'rifiuto.codiceEerNonValido' }],
      })

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimento/2026/1`,
        headers: await intestazioni(),
      })
      expect(dettaglio.statusCode).toBe(404)

      await app.close()
    })
  })

  describe('GET /operatore/{identificativo_registro}/movimenti (elenco/count)', () => {
    async function seedRegistrazione(app: any, anno: number, progressivo: number): Promise<string> {
      const invio = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(anno, progressivo)],
      })
      const { transazione_id: transazioneId } = invio.json()
      await completaTransazione(app, transazioneId)
      const risultato = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/${transazioneId}/result`,
        headers: await intestazioni(),
      })
      return risultato.json().esito.numero_registrazioni[0].identificativo
    }

    it('elenca le registrazioni di un registro, con gli header di paginazione, e conta allo stesso modo', async () => {
      const app = creaApp()
      await registraRegistro(app)
      await registraRegistro(app, REGISTRO_ALTRO)

      await seedRegistrazione(app, 2026, 1)
      await seedRegistrazione(app, 2026, 2)

      // Su un registro diverso: non deve comparire nell'elenco del primo.
      const invioAltro = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO_ALTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })
      await completaTransazione(app, invioAltro.json().transazione_id)

      const elenco = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
      })
      expect(elenco.statusCode).toBe(200)
      expect(elenco.json()).toHaveLength(2)
      expect(elenco.headers['paging-totalrecordcount']).toBe('2')

      const conteggio = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti/count`,
        headers: await intestazioni(),
      })
      expect(conteggio.statusCode).toBe(200)
      expect(conteggio.json()).toBe(2)

      await app.close()
    })

    it('filtra per anno/progressivo', async () => {
      const app = creaApp()
      await registraRegistro(app)
      await seedRegistrazione(app, 2026, 1)
      await seedRegistrazione(app, 2026, 2)

      const elenco = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti?anno=2026&progressivo=2`,
        headers: await intestazioni(),
      })
      const risultati = elenco.json()
      expect(risultati).toHaveLength(1)
      expect(risultati[0].riferimenti.numero_registrazione.progressivo).toBe(2)

      await app.close()
    })

    it('risponde 404 su un registro mai aperto', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(404)

      await app.close()
    })
  })

  describe('rettifica e annullamento (POST .../movimenti riusato)', () => {
    it('una rettifica marca la registrazione originale come rettificata e la collega alla nuova', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const invioOriginale = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })
      await completaTransazione(app, invioOriginale.json().transazione_id)

      const rettifica = movimentoValido(2026, 2)
      ;(rettifica.riferimenti as Record<string, unknown>).numero_registrazione_rettifica = {
        anno: 2026,
        progressivo: 1,
      }
      const invioRettifica = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [rettifica],
      })
      await completaTransazione(app, invioRettifica.json().transazione_id)

      const dettaglioOriginale = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimento/2026/1`,
        headers: await intestazioni(),
      })
      const corpoOriginale = dettaglioOriginale.json()
      expect(corpoOriginale.rettificato).toBe(true)
      expect(corpoOriginale.riferimenti.numero_registrazione_di_rettifica.progressivo).toBe(2)
      expect(corpoOriginale.variazioni).toHaveLength(1)
      expect(corpoOriginale.variazioni[0].riferimenti.numero_registrazione.progressivo).toBe(2)

      await app.close()
    })

    it('un annullamento marca la registrazione originale come annullata', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const invioOriginale = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })
      await completaTransazione(app, invioOriginale.json().transazione_id)

      const annullamento = {
        numero_registrazione: { anno: 2026, progressivo: 2 },
        numero_registrazione_annullata: { anno: 2026, progressivo: 1 },
        data_ora_registrazione: '2026-01-12T08:00:00Z',
        annotazioni: 'Registrazione errata',
      }
      const invioAnnullamento = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [annullamento],
      })
      await completaTransazione(app, invioAnnullamento.json().transazione_id)

      const dettaglioOriginale = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimento/2026/1`,
        headers: await intestazioni(),
      })
      expect(dettaglioOriginale.json().annullato).toBe(true)

      await app.close()
    })
  })

  describe('POST /operatore/{identificativo_registro}/valida', () => {
    function corpoValidaValido(): Record<string, unknown> {
      return {
        file_content: Buffer.from('<registro></registro>').toString('base64'),
        nome_file: 'registro.xml',
        mime: 'application/xml',
      }
    }

    it('accetta la richiesta: 202, TransazioneModel, ciclo completabile via /status e /result', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/valida`,
        headers: await intestazioni(),
        payload: corpoValidaValido(),
      })
      expect(risposta.statusCode).toBe(202)
      const { transazione_id: transazioneId } = risposta.json()

      await app.inject({
        method: 'POST',
        url: '/__controllo/dati-registri/completa-transazione',
        payload: {
          transazione_id: transazioneId,
          errore: false,
          validazione: [],
          esito: { identificativo_registro: REGISTRO, numero_registrazioni_file: 1 },
        },
      })

      const risultato = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/${transazioneId}/result`,
        headers: await intestazioni(),
      })
      expect(risultato.statusCode).toBe(200)
      expect(risultato.json().esito.numero_registrazioni_file).toBe(1)

      await app.close()
    })

    it('rifiuta un corpo senza file_content: 400', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/valida`,
        headers: await intestazioni(),
        payload: { nome_file: 'x.xml', mime: 'application/xml' },
      })
      expect(risposta.statusCode).toBe(400)

      await app.close()
    })

    it('risponde 404 su un registro mai aperto', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/valida`,
        headers: await intestazioni(),
        payload: corpoValidaValido(),
      })
      expect(risposta.statusCode).toBe(404)

      await app.close()
    })
  })

  describe('GET /{identificativo_registro}/last-transazione-id', () => {
    it('risponde 204 se nessuna trasmissione e mai stata inviata', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/${REGISTRO}/last-transazione-id`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(204)

      await app.close()
    })

    it('restituisce il transazione_id dell ultima trasmissione inviata', async () => {
      const app = creaApp()
      await registraRegistro(app)

      const invio = await app.inject({
        method: 'POST',
        url: `/dati-registri/v1.0/operatore/${REGISTRO}/movimenti`,
        headers: await intestazioni(),
        payload: [movimentoValido(2026, 1)],
      })
      const { transazione_id: transazioneId } = invio.json()

      const risposta = await app.inject({
        method: 'GET',
        url: `/dati-registri/v1.0/${REGISTRO}/last-transazione-id`,
        headers: await intestazioni(),
      })
      expect(risposta.statusCode).toBe(200)
      expect(risposta.json().transazione_id).toBe(transazioneId)

      await app.close()
    })
  })
})
