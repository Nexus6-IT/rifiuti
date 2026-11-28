import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'
import { corpoNuovoFormularioValido } from './aiuti/formulario'

/**
 * Numero del formulario nell'esito di creazione, secondo il contratto ufficiale.
 *
 * - Richiesta: `DatiPartenzaModel.numero_fir` (formulari.yaml, "Numero di vidimazione da
 *   attribuire al nuovo FIR digitale. Qualora non venga specificato, il sistema ne assegnerà uno
 *   automaticamente").
 * - Esito: `EsitoNuovoFormularioModel.numero_fir` (nullable).
 *
 * Quindi: se la richiesta indica un numero, l'ente attribuisce QUEL numero e lo restituisce; se
 * non lo indica, lo sceglie l'ente. Un esito con un numero diverso da quello richiesto non e'
 * previsto dal contratto: la fake non lo produce, salvo richiesta esplicita del test.
 */

async function intestazioni(): Promise<{ authorization: string }> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', x5c: [certificatoBase64Der] } as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience('rentrigov.demo.api')
    .setIssuedAt()
    .setExpirationTime('300s')
    .setJti(randomUUID())
    .sign(chiave)
  return { authorization: `Bearer ${token}` }
}

const NUMERO_RICHIESTO = 'BCDFGH 000123 XY'
const NUMERO_DIVERSO = 'BCDFGH 000124 XY'

function corpoConNumero(numero?: string): Record<string, unknown> {
  const base = corpoNuovoFormularioValido() as { dati_partenza: Record<string, unknown> }
  return numero ? { ...base, dati_partenza: { ...base.dati_partenza, numero_fir: numero } } : base
}

async function crea(app: ReturnType<typeof creaApp>, numero?: string): Promise<string> {
  const risposta = await app.inject({
    method: 'POST',
    url: '/formulari/v1.0/',
    headers: await intestazioni(),
    payload: corpoConNumero(numero),
  })
  expect(risposta.statusCode).toBe(202)
  return risposta.json().transazione_id
}

async function completa(
  app: ReturnType<typeof creaApp>,
  id: string,
  extra: Record<string, unknown>
) {
  return app.inject({
    method: 'POST',
    url: '/__controllo/completa-transazione',
    payload: { transazione_id: id, errore: false, validazione: [], ...extra },
  })
}

async function leggiEsito(app: ReturnType<typeof creaApp>, id: string) {
  const risultato = await app.inject({
    method: 'GET',
    url: `/formulari/v1.0/${id}/result`,
    headers: await intestazioni(),
  })
  return risultato
}

describe('Numero del formulario nell esito di creazione', () => {
  it('la richiesta indica un numero e il test non dichiara l esito: l ente restituisce quel numero', async () => {
    const app = creaApp()
    const id = await crea(app, NUMERO_RICHIESTO)

    const completata = await completa(app, id, {})

    expect(completata.statusCode).toBe(200)
    const risultato = await leggiEsito(app, id)
    expect(risultato.json().esito.numero_fir).toBe(NUMERO_RICHIESTO)
    await app.close()
  })

  it('il formulario registrato in archivio porta il numero richiesto', async () => {
    const app = creaApp()
    const id = await crea(app, NUMERO_RICHIESTO)
    await completa(app, id, {})

    const lettura = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${encodeURIComponent(NUMERO_RICHIESTO)}`,
      headers: await intestazioni(),
    })

    expect(lettura.statusCode).toBe(200)
    await app.close()
  })

  it('l esito dichiarato dal test con lo stesso numero richiesto e accettato', async () => {
    const app = creaApp()
    const id = await crea(app, NUMERO_RICHIESTO)

    const completata = await completa(app, id, { esito: { numero_fir: NUMERO_RICHIESTO } })

    expect(completata.statusCode).toBe(200)
    await app.close()
  })

  it('un esito con numero diverso da quello richiesto non e previsto dal contratto: 400, transazione ancora in elaborazione', async () => {
    const app = creaApp()
    const id = await crea(app, NUMERO_RICHIESTO)

    const completata = await completa(app, id, { esito: { numero_fir: NUMERO_DIVERSO } })

    expect(completata.statusCode).toBe(400)
    expect(completata.headers['content-type']).toContain('application/problem+json')
    const stato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/status`,
      headers: await intestazioni(),
    })
    expect(stato.statusCode).toBe(200)
    await app.close()
  })

  it('con esito_non_conforme il test simula un ente difettoso: il numero diverso passa', async () => {
    const app = creaApp()
    const id = await crea(app, NUMERO_RICHIESTO)

    const completata = await completa(app, id, {
      esito: { numero_fir: NUMERO_DIVERSO },
      esito_non_conforme: true,
    })

    expect(completata.statusCode).toBe(200)
    const risultato = await leggiEsito(app, id)
    expect(risultato.json().esito.numero_fir).toBe(NUMERO_DIVERSO)
    await app.close()
  })

  it('senza numero richiesto lo sceglie l ente: il test puo dichiararne uno qualsiasi', async () => {
    const app = creaApp()
    const id = await crea(app)

    const completata = await completa(app, id, { esito: { numero_fir: NUMERO_DIVERSO } })

    expect(completata.statusCode).toBe(200)
    const risultato = await leggiEsito(app, id)
    expect(risultato.json().esito.numero_fir).toBe(NUMERO_DIVERSO)
    await app.close()
  })

  it('senza numero richiesto e senza esito dichiarato nessun numero e inventato dalla fake', async () => {
    const app = creaApp()
    const id = await crea(app)

    await completa(app, id, {})

    const risultato = await leggiEsito(app, id)
    expect(risultato.json().esito).toBeUndefined()
    await app.close()
  })

  it('un esito di errore non riceve il numero richiesto (nessun formulario creato)', async () => {
    const app = creaApp()
    const id = await crea(app, NUMERO_RICHIESTO)

    await completa(app, id, {
      errore: true,
      validazione: [{ campo: 'numero_fir', tipo: 'Errore', codice_messaggio: 'FIR_DUPLICATO' }],
    })

    const risultato = await leggiEsito(app, id)
    expect(risultato.json().errore).toBe(true)
    expect(risultato.json().esito).toBeUndefined()
    await app.close()
  })
})
