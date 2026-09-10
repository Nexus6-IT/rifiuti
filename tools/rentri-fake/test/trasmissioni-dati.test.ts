import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'
import { corpoTrasmissioneDatiValido } from './aiuti/trasmissione-dati'

// Un jti diverso ad ogni chiamata (FEDELTA.md §5.2 punto 3, anti-replay): v.
// lo stesso commento in transazioni.test.ts.
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

const NUM_ISCR_SITO = 'OP1234ABC000001-AB0001'
const NUM_ISCR_SITO_ALTRO = 'OP9999XYZ000009-ZZ9999'

describe('Trasmissione dati operatore (formulari.yaml righe 5149-5577)', () => {
  describe('POST /trasmissioni/operatore/{num_iscr_sito}', () => {
    it('registra la trasmissione: 201, TrasmissioneFormularioResponse con identificativo, header Location', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })

      expect(risposta.statusCode).toBe(201)
      const corpo = risposta.json()
      expect(corpo).toHaveProperty('identificativo')
      expect(typeof corpo.identificativo).toBe('string')
      expect(risposta.headers.location).toBe(
        `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${corpo.identificativo}`
      )

      await app.close()
    })

    it('rifiuta un num_iscr_sito mal formato: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: '/formulari/v1.0/trasmissioni/operatore/non-valido',
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })

    it('rifiuta un corpo senza dati_partenza: 400 problem+json', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: {},
      })

      expect(risposta.statusCode).toBe(400)
      expect(risposta.headers['content-type']).toContain('application/problem+json')

      await app.close()
    })

    it('rifiuta un destinatario privo di indirizzo (DatiDestinatarioTrasmissioneModel): 400', async () => {
      const app = creaApp()
      const corpo = corpoTrasmissioneDatiValido()
      const partenza = corpo.dati_partenza as Record<string, unknown>
      const destinatario = { ...(partenza.destinatario as Record<string, unknown>) }
      delete destinatario.indirizzo
      partenza.destinatario = destinatario

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpo,
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })

    it('rifiuta senza autenticazione: 403 (mai 401)', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        payload: corpoTrasmissioneDatiValido(),
      })

      expect(risposta.statusCode).toBe(403)

      await app.close()
    })

    it('accetta num_iscr_sito_produttore e lo riporta nel dettaglio come sito_trasportatore_per_conto_produttore', async () => {
      const app = creaApp()
      const numIscrSitoProduttore = 'OP5555DEF000005-CC5555'

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}?num_iscr_sito_produttore=${numIscrSitoProduttore}`,
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })
      expect(invio.statusCode).toBe(201)
      const { identificativo } = invio.json()

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${identificativo}`,
        headers: await intestazioni(),
      })

      expect(dettaglio.json().sito_trasportatore_per_conto_produttore).toEqual(
        expect.objectContaining({ num_iscr_sito: numIscrSitoProduttore })
      )

      await app.close()
    })
  })

  describe('GET /trasmissioni/operatore/{num_iscr_sito}/{identificativo}', () => {
    it('legge il dettaglio appena creato, incluso il formulario trasmesso', async () => {
      const app = creaApp()
      const corpo = corpoTrasmissioneDatiValido()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpo,
      })
      const { identificativo } = invio.json()

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${identificativo}`,
        headers: await intestazioni(),
      })

      expect(dettaglio.statusCode).toBe(200)
      const corpoRisposta = dettaglio.json()
      expect(corpoRisposta.identificativo).toBe(identificativo)
      expect(corpoRisposta.numero_fir).toBe('TSTB12345XY')
      expect(corpoRisposta.stato).toBe('Attivo')
      expect(corpoRisposta.tipo).toBe('Api')
      expect(corpoRisposta.formulario).toEqual(corpo)

      await app.close()
    })

    it('risponde 404 per un identificativo inesistente', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${randomUUID()}`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(404)

      await app.close()
    })

    it('risponde 404 se la trasmissione esiste ma per un num_iscr_sito diverso (confine di visibilita)', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })
      const { identificativo } = invio.json()

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO_ALTRO}/${identificativo}`,
        headers: await intestazioni(),
      })

      expect(dettaglio.statusCode).toBe(404)

      await app.close()
    })
  })

  describe('GET /trasmissioni/operatore/{num_iscr_sito} (elenco)', () => {
    it('elenca solo le trasmissioni del num_iscr_sito richiesto, con gli header di paginazione', async () => {
      const app = creaApp()

      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })
      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO_ALTRO}`,
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })

      const elenco = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
      })

      expect(elenco.statusCode).toBe(200)
      const risultati = elenco.json()
      expect(risultati).toHaveLength(1)
      expect(risultati[0]).not.toHaveProperty('formulario')
      expect(elenco.headers['paging-totalrecordcount']).toBe('1')

      await app.close()
    })

    it('filtra per numero_fir', async () => {
      const app = creaApp()
      const corpoAltro = corpoTrasmissioneDatiValido()
      ;(corpoAltro.dati_partenza as Record<string, unknown>).numero_fir = 'TSTC98765ZY'

      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })
      await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpoAltro,
      })

      const elenco = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}?numero_fir=TSTC98765ZY`,
        headers: await intestazioni(),
      })

      const risultati = elenco.json()
      expect(risultati).toHaveLength(1)
      expect(risultati[0].numero_fir).toBe('TSTC98765ZY')

      await app.close()
    })
  })

  describe('DELETE /trasmissioni/operatore/{num_iscr_sito}/{identificativo}/annulla', () => {
    it('annulla una trasmissione attiva: 200, e lo stato diventa Annullato', async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })
      const { identificativo } = invio.json()

      const annulla = await app.inject({
        method: 'DELETE',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${identificativo}/annulla`,
        headers: await intestazioni(),
      })
      expect(annulla.statusCode).toBe(200)

      const dettaglio = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${identificativo}`,
        headers: await intestazioni(),
      })
      expect(dettaglio.json().stato).toBe('Annullato')

      await app.close()
    })

    it("e' non reversibile: annullarla una seconda volta risponde 400", async () => {
      const app = creaApp()

      const invio = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}`,
        headers: await intestazioni(),
        payload: corpoTrasmissioneDatiValido(),
      })
      const { identificativo } = invio.json()

      await app.inject({
        method: 'DELETE',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${identificativo}/annulla`,
        headers: await intestazioni(),
      })
      const secondoAnnullo = await app.inject({
        method: 'DELETE',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${identificativo}/annulla`,
        headers: await intestazioni(),
      })

      expect(secondoAnnullo.statusCode).toBe(400)
      expect(secondoAnnullo.headers['content-type']).toContain('application/problem+json')

      await app.close()
    })

    it('risponde 404 per un identificativo inesistente', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'DELETE',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${randomUUID()}/annulla`,
        headers: await intestazioni(),
      })

      expect(risposta.statusCode).toBe(404)

      await app.close()
    })
  })

  // Ciclo NONBLOCK_PULL: come `POST /formulari/v1.0/` (v. transazioni.test.ts),
  // qui riusato dai path canonici /status e /result senza reimplementarlo.
  describe('POST /trasmissioni/operatore/{num_iscr_sito}/{numero_fir}/estrai', () => {
    const NUMERO_FIR = 'TSTB12345XY'

    it('accetta la richiesta: 202, TransazioneModel con transazione_id uuid, header Location verso lo status canonico', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${NUMERO_FIR}/estrai`,
        headers: await intestazioni(),
        payload: { xfir: Buffer.from('contenuto-xfir-di-prova').toString('base64') },
      })

      expect(risposta.statusCode).toBe(202)
      const corpo = risposta.json()
      expect(corpo.transazione_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
      expect(risposta.headers.location).toBe(`/formulari/v1.0/${corpo.transazione_id}/status`)

      await app.close()
    })

    it('il ciclo si completa tramite i path canonici /status e /result (non quelli deprecati sotto /trasmissioni/)', async () => {
      const app = creaApp()

      const estrazione = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${NUMERO_FIR}/estrai`,
        headers: await intestazioni(),
        payload: { xfir: Buffer.from('contenuto-xfir-di-prova').toString('base64') },
      })
      const { transazione_id: transazioneId } = estrazione.json()

      const statoPrimaDelCompletamento = await app.inject({
        method: 'GET',
        url: `/formulari/v1.0/${transazioneId}/status`,
        headers: await intestazioni(),
      })
      expect(statoPrimaDelCompletamento.statusCode).toBe(200)
      expect(statoPrimaDelCompletamento.body).toBe('')

      await app.inject({
        method: 'POST',
        url: '/__controllo/completa-transazione',
        payload: {
          transazione_id: transazioneId,
          errore: false,
          validazione: [],
          esito: { dati_partenza: { numero_fir: NUMERO_FIR } },
        },
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

    it('rifiuta un corpo senza xfir: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${NUMERO_FIR}/estrai`,
        headers: await intestazioni(),
        payload: {},
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })

    it('rifiuta un numero_fir mal formato: 400', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/non-un-fir/estrai`,
        headers: await intestazioni(),
        payload: { xfir: Buffer.from('x').toString('base64') },
      })

      expect(risposta.statusCode).toBe(400)

      await app.close()
    })

    it('con X-ReplyTo non emette Location (nessuna callback reale inviata dalla fake)', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: `/formulari/v1.0/trasmissioni/operatore/${NUM_ISCR_SITO}/${NUMERO_FIR}/estrai`,
        headers: { ...(await intestazioni()), 'x-replyto': 'https://esempio.invalid/callback' },
        payload: { xfir: Buffer.from('x').toString('base64') },
      })

      expect(risposta.statusCode).toBe(202)
      expect(risposta.headers.location).toBeUndefined()

      await app.close()
    })
  })
})
