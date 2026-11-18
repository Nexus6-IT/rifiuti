import { creaApp } from '../src/app'
import { intestazioniAutenticate } from './aiuti/token'
import {
  NUMERO_FIR_VIAGGIO,
  corpoAnnotazioneValido,
  corpoDestinatarioSitoValido,
  corpoQuantitaValido,
  corpoSostaTecnicaValido,
  corpoTrasbordoParzialeValido,
  corpoTrasbordoTotaleValido,
  corpoTrasportoTerrestreValido,
} from './aiuti/operazioni-viaggio'

/**
 * Rotte asincrone delle operazioni del FIR in viaggio (piano
 * `2026-11-18-rentri-fir-viaggio.md`, P0 T1). Ognuna rispetta il ciclo del
 * contratto: 202 + `TransazioneModel` + `Location`, e rifiuta cio' che il
 * contratto rifiuterebbe (corpo non valido, FIR inesistente o malformato,
 * token mancante). Il completamento passa dal canale di controllo.
 */

const PREFISSO = '/formulari/v1.0'

type Rotta = {
  segmento: string
  corpoValido?: () => Record<string, unknown>
  /** Un corpo che il modello del contratto rifiuta. */
  corpoNonValido?: Record<string, unknown>
}

const ROTTE: Rotta[] = [
  { segmento: 'quantita', corpoValido: corpoQuantitaValido, corpoNonValido: { rinfusa: true } },
  {
    segmento: 'trasporto',
    corpoValido: corpoTrasportoTerrestreValido,
    corpoNonValido: { data_ora_inizio_trasporto: '2026-11-18T08:30:00Z' },
  },
  {
    segmento: 'annotazione',
    corpoValido: corpoAnnotazioneValido,
    corpoNonValido: { annotazione: 'senza soggetto' },
  },
  {
    segmento: 'sosta-tecnica',
    corpoValido: corpoSostaTecnicaValido,
    corpoNonValido: { luogo_stazionamento: 'solo il luogo' },
  },
  {
    segmento: 'trasbordo-totale',
    corpoValido: corpoTrasbordoTotaleValido,
    corpoNonValido: { trasportatore: { num_iscr_sito: 'OP1234ABC000009-AB0009' } },
  },
  {
    segmento: 'trasbordo-parziale',
    corpoValido: corpoTrasbordoParzialeValido,
    corpoNonValido: { numero_fir: 'BCDFGH00021ZD' },
  },
  {
    segmento: 'destinatario',
    corpoValido: corpoDestinatarioSitoValido,
    corpoNonValido: { denominazione: 'senza codice fiscale ne indirizzo' },
  },
  { segmento: 'reset' },
  { segmento: 'rollback-firma' },
]

async function seminaFormulario(app: ReturnType<typeof creaApp>): Promise<void> {
  const risposta = await app.inject({
    method: 'POST',
    url: '/__controllo/formulario',
    payload: { numero_fir: NUMERO_FIR_VIAGGIO, stato: 'InserimentoAccettazione' },
  })
  expect(risposta.statusCode).toBe(200)
}

describe.each(ROTTE)(
  'POST /{numero_fir}/$segmento',
  ({ segmento, corpoValido, corpoNonValido }) => {
    const url = (numeroFir: string): string => `${PREFISSO}/${numeroFir}/${segmento}`

    it('202 con TransazioneModel e Location verso /status per un corpo valido', async () => {
      const app = creaApp()
      await seminaFormulario(app)

      const risposta = await app.inject({
        method: 'POST',
        url: url(NUMERO_FIR_VIAGGIO),
        headers: await intestazioniAutenticate(),
        payload: corpoValido?.(),
      })

      expect(risposta.statusCode).toBe(202)
      const { transazione_id } = risposta.json()
      expect(transazione_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(risposta.headers.location).toBe(`${PREFISSO}/${transazione_id}/status`)
    })

    it('403 senza token', async () => {
      const app = creaApp()
      await seminaFormulario(app)

      const risposta = await app.inject({
        method: 'POST',
        url: url(NUMERO_FIR_VIAGGIO),
        payload: corpoValido?.(),
      })

      expect(risposta.statusCode).toBe(403)
    })

    it('404 per un formulario che non esiste', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: url('BCDFGH99999ZD'),
        headers: await intestazioniAutenticate(),
        payload: corpoValido?.(),
      })

      expect(risposta.statusCode).toBe(404)
    })

    it('400 per un numero FIR malformato', async () => {
      const app = creaApp()

      const risposta = await app.inject({
        method: 'POST',
        url: url('non-un-numero-fir'),
        headers: await intestazioniAutenticate(),
        payload: corpoValido?.(),
      })

      expect(risposta.statusCode).toBe(400)
    })

    if (corpoNonValido) {
      it('400 per un corpo che il modello del contratto rifiuta', async () => {
        const app = creaApp()
        await seminaFormulario(app)

        const risposta = await app.inject({
          method: 'POST',
          url: url(NUMERO_FIR_VIAGGIO),
          headers: await intestazioniAutenticate(),
          payload: corpoNonValido,
        })

        expect(risposta.statusCode).toBe(400)
        expect(risposta.json().detail).toEqual(expect.any(String))
      })
    }
  }
)

describe('Validazioni oltre il modello del contratto', () => {
  it('sosta-tecnica: la ripresa deve seguire la sospensione', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/sosta-tecnica`,
      headers: await intestazioniAutenticate(),
      payload: {
        ...corpoSostaTecnicaValido(),
        data_ora_ripresa: '2026-11-18T09:00:00Z',
      },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.json().detail).toContain('data_ora_ripresa')
  })

  it('trasporto: la targa non supera i 10 caratteri del contratto', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/trasporto`,
      headers: await intestazioniAutenticate(),
      payload: { ...corpoTrasportoTerrestreValido(), targa_automezzo: 'TARGATROPPOLUNGA' },
    })

    expect(risposta.statusCode).toBe(400)
  })

  it('quantita: il contratto ammette solo kg e l', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/quantita`,
      headers: await intestazioniAutenticate(),
      payload: { quantita: { valore: 1, unita_misura: 't' } },
    })

    expect(risposta.statusCode).toBe(400)
  })

  it('destinatario: accetta anche la forma completa (codice fiscale, denominazione, indirizzo)', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/destinatario`,
      headers: await intestazioniAutenticate(),
      payload: {
        codice_fiscale: '01234567890',
        denominazione: 'Recuperi Nord Srl',
        indirizzo: { citta: { comune_id: '015146' }, indirizzo: 'Via Roma' },
      },
    })

    expect(risposta.statusCode).toBe(202)
  })
})

describe('POST /{numero_fir}/invia-a-dispositivo (sincrona)', () => {
  const url = (numeroFir: string, query = '?credentials_id=cred-1'): string =>
    `${PREFISSO}/${numeroFir}/invia-a-dispositivo${query}`

  it('200 senza corpo quando il formulario esiste e credentials_id e` indicato', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({
      method: 'POST',
      url: url(NUMERO_FIR_VIAGGIO),
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(200)
  })

  it('400 senza credentials_id (obbligatorio nel contratto)', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({
      method: 'POST',
      url: url(NUMERO_FIR_VIAGGIO, ''),
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(400)
  })

  it('404 per un formulario inesistente', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: url('BCDFGH99999ZD'),
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(404)
  })

  it('403 senza token', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({ method: 'POST', url: url(NUMERO_FIR_VIAGGIO) })

    expect(risposta.statusCode).toBe(403)
  })
})

describe('Reset e rollback-firma: effetto sullo stato', () => {
  async function avvia(
    app: ReturnType<typeof creaApp>,
    segmento: string,
    corpo?: Record<string, unknown>
  ): Promise<string> {
    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/${segmento}`,
      headers: await intestazioniAutenticate(),
      payload: corpo,
    })
    expect(risposta.statusCode).toBe(202)
    return risposta.json().transazione_id as string
  }

  async function completa(app: ReturnType<typeof creaApp>, transazioneId: string): Promise<void> {
    const risposta = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: transazioneId, errore: false },
    })
    expect(risposta.statusCode).toBe(200)
  }

  async function stato(app: ReturnType<typeof creaApp>): Promise<string> {
    const risposta = await app.inject({
      method: 'GET',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/stato`,
      headers: await intestazioniAutenticate(),
    })
    return risposta.json().stato_formulario as string
  }

  const accettazione = { tipo_accettazione: 'A', data_ora_arrivo: '2026-11-18T14:00:00Z' }

  it('reset dopo l`accettazione (in attesa di firma) riporta allo stato precedente', async () => {
    const app = creaApp()
    await seminaFormulario(app)
    await completa(app, await avvia(app, 'accettazione', accettazione))
    expect(await stato(app)).toBe('FirmaAccettazione')

    await completa(app, await avvia(app, 'reset'))

    expect(await stato(app)).toBe('InserimentoAccettazione')
  })

  it('rollback-firma dopo la firma dell`accettazione riporta all`attesa di firma', async () => {
    const app = creaApp()
    await seminaFormulario(app)
    await completa(app, await avvia(app, 'accettazione', accettazione))
    await completa(
      app,
      await avvia(app, 'acquisizione-firma', { certificato: 'c', token: 't', firma: 'f' })
    )
    expect(await stato(app)).toBe('Accettato')

    await completa(app, await avvia(app, 'rollback-firma'))

    expect(await stato(app)).toBe('FirmaAccettazione')
  })

  it('un reset senza nulla da annullare non cambia lo stato', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    await completa(app, await avvia(app, 'reset'))

    expect(await stato(app)).toBe('InserimentoAccettazione')
  })

  it('l`annullamento firmato non e` reversibile con rollback-firma', async () => {
    const app = creaApp()
    await seminaFormulario(app)
    await completa(app, await avvia(app, 'annulla-fir'))
    await completa(
      app,
      await avvia(app, 'acquisizione-firma', { certificato: 'c', token: 't', firma: 'f' })
    )
    expect(await stato(app)).toBe('Annullato')

    await completa(app, await avvia(app, 'rollback-firma'))

    expect(await stato(app)).toBe('Annullato')
  })
})
