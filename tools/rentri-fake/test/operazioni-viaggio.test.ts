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
  /** Stato in cui il contratto ammette l'operazione. */
  statoAmmesso: string
  /** Stato in cui NON la ammette. */
  statoNonAmmesso: string
  /** Campi aggiuntivi del formulario seminato nello stato ammesso. */
  extraAmmesso?: Record<string, unknown>
  corpoValido?: () => Record<string, unknown>
  /** Un corpo che il modello del contratto rifiuta. */
  corpoNonValido?: Record<string, unknown>
}

const ROTTE: Rotta[] = [
  {
    segmento: 'quantita',
    statoAmmesso: 'InserimentoQuantita',
    statoNonAmmesso: 'InserimentoAccettazione',
    corpoValido: corpoQuantitaValido,
    corpoNonValido: { rinfusa: true },
  },
  {
    segmento: 'trasporto',
    statoAmmesso: 'InserimentoTrasportoIniziale',
    statoNonAmmesso: 'Accettato',
    corpoValido: corpoTrasportoTerrestreValido,
    corpoNonValido: { data_ora_inizio_trasporto: '2026-11-18T08:30:00Z' },
  },
  {
    segmento: 'annotazione',
    statoAmmesso: 'InserimentoAccettazione',
    statoNonAmmesso: 'FirmaAccettazione',
    corpoValido: corpoAnnotazioneValido,
    corpoNonValido: { annotazione: 'senza soggetto' },
  },
  {
    segmento: 'sosta-tecnica',
    statoAmmesso: 'InserimentoAccettazione',
    statoNonAmmesso: 'Accettato',
    corpoValido: corpoSostaTecnicaValido,
    corpoNonValido: { luogo_stazionamento: 'solo il luogo' },
  },
  {
    segmento: 'trasbordo-totale',
    statoAmmesso: 'InserimentoAccettazione',
    statoNonAmmesso: 'Accettato',
    corpoValido: corpoTrasbordoTotaleValido,
    corpoNonValido: { trasportatore: { num_iscr_sito: 'OP1234ABC000009-AB0009' } },
  },
  {
    segmento: 'trasbordo-parziale',
    statoAmmesso: 'InserimentoAccettazione',
    statoNonAmmesso: 'Accettato',
    corpoValido: corpoTrasbordoParzialeValido,
    corpoNonValido: { numero_fir: 'BCDFGH00021ZD' },
  },
  {
    segmento: 'destinatario',
    statoAmmesso: 'RespintoAccettatoParzialmente',
    statoNonAmmesso: 'InserimentoAccettazione',
    corpoValido: corpoDestinatarioSitoValido,
    corpoNonValido: { denominazione: 'senza codice fiscale ne indirizzo' },
  },
  {
    segmento: 'reset',
    statoAmmesso: 'FirmaAnnotazione',
    statoNonAmmesso: 'InserimentoAccettazione',
  },
  {
    segmento: 'rollback-firma',
    statoAmmesso: 'Accettato',
    statoNonAmmesso: 'InserimentoAccettazione',
    extraAmmesso: {
      ultimaFirma: {
        statoPrecedente: 'FirmaAccettazione',
        pending: {
          tipo: 'Accettazione',
          corpo: { tipo_accettazione: 'A' },
          statoPrecedente: 'InserimentoAccettazione',
        },
      },
    },
  },
]

async function seminaFormulario(
  app: ReturnType<typeof creaApp>,
  stato = 'InserimentoAccettazione',
  extra: Record<string, unknown> = {}
): Promise<void> {
  const risposta = await app.inject({
    method: 'POST',
    url: '/__controllo/formulario',
    payload: { numero_fir: NUMERO_FIR_VIAGGIO, stato, ...extra },
  })
  expect(risposta.statusCode).toBe(200)
}

describe.each(ROTTE)(
  'POST /{numero_fir}/$segmento',
  ({ segmento, corpoValido, corpoNonValido, statoAmmesso, statoNonAmmesso, extraAmmesso }) => {
    const url = (numeroFir: string): string => `${PREFISSO}/${numeroFir}/${segmento}`

    it('202 con TransazioneModel e Location verso /status per un corpo valido', async () => {
      const app = creaApp()
      await seminaFormulario(app, statoAmmesso, extraAmmesso)

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

    it('403 «Operazione non consentita» se lo stato del formulario non ammette l`operazione', async () => {
      const app = creaApp()
      await seminaFormulario(app, statoNonAmmesso)

      const risposta = await app.inject({
        method: 'POST',
        url: url(NUMERO_FIR_VIAGGIO),
        headers: await intestazioniAutenticate(),
        payload: corpoValido?.(),
      })

      expect(risposta.statusCode).toBe(403)
      expect(risposta.json().detail).toContain(statoNonAmmesso)
    })

    it('403 senza token', async () => {
      const app = creaApp()
      await seminaFormulario(app, statoAmmesso, extraAmmesso)

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
        await seminaFormulario(app, statoAmmesso, extraAmmesso)

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
    await seminaFormulario(app, 'InserimentoTrasportoIniziale')

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
    await seminaFormulario(app, 'InserimentoQuantita')

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
    await seminaFormulario(app, 'RespintoAccettatoParzialmente')

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

describe('destinatario: oneOf rigoroso', () => {
  it('rifiuta un corpo che soddisfa entrambe le forme (completa e sito)', async () => {
    const app = creaApp()
    await seminaFormulario(app, 'RespintoAccettatoParzialmente')

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/destinatario`,
      headers: await intestazioniAutenticate(),
      payload: {
        ...corpoDestinatarioSitoValido(),
        codice_fiscale: '01234567890',
        denominazione: 'Recuperi Nord Srl',
        indirizzo: { citta: { comune_id: '015146' }, indirizzo: 'Via Roma' },
      },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.json().detail).toContain('entrambe')
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

  it('un reset fuori dagli stati di firma e` rifiutato con 403, non un esito vuoto', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/reset`,
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(403)
  })

  it('rollback-firma senza una firma reversibile e` rifiutato con 403', async () => {
    const app = creaApp()
    await seminaFormulario(app)

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/rollback-firma`,
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(403)
  })

  it('coerenza: /azioni propone RollbackFirma se e solo se la fake lo eseguirebbe', async () => {
    const app = creaApp()
    await seminaFormulario(app)
    const azioni = async (): Promise<string[]> =>
      (
        await app.inject({
          method: 'GET',
          url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/azioni?identificativo_soggetto=RSSMRA80A01H501U`,
          headers: await intestazioniAutenticate(),
        })
      ).json().azioni

    expect(await azioni()).not.toContain('RollbackFirma')

    await completa(app, await avvia(app, 'accettazione', accettazione))
    await completa(
      app,
      await avvia(app, 'acquisizione-firma', { certificato: 'c', token: 't', firma: 'f' })
    )
    expect(await azioni()).toContain('RollbackFirma')

    await completa(app, await avvia(app, 'rollback-firma'))
    expect(await stato(app)).toBe('FirmaAccettazione')
    expect(await azioni()).not.toContain('RollbackFirma')
  })

  it('l`annullamento firmato non e` reversibile: /azioni non propone il rollback e la rotta risponde 403', async () => {
    const app = creaApp()
    await seminaFormulario(app)
    await completa(app, await avvia(app, 'annulla-fir'))
    await completa(
      app,
      await avvia(app, 'acquisizione-firma', { certificato: 'c', token: 't', firma: 'f' })
    )
    expect(await stato(app)).toBe('Annullato')

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/rollback-firma`,
      headers: await intestazioniAutenticate(),
    })

    expect(risposta.statusCode).toBe(403)
    expect(await stato(app)).toBe('Annullato')
  })
})

describe('Quantita e trasporto: fase iniziale del formulario (FIR in viaggio, P2)', () => {
  async function avvia(
    app: ReturnType<typeof creaApp>,
    segmento: string,
    corpo: Record<string, unknown>
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

  it.each([
    ['InserimentoQuantitaTrasportoIniziale', 'quantita', 'InserimentoTrasportoIniziale'],
    ['InserimentoQuantita', 'quantita', 'FirmaProduttoreTrasportatoreIniziale'],
    ['InserimentoQuantitaTrasportoIniziale', 'trasporto', 'InserimentoQuantita'],
    ['InserimentoTrasportoIniziale', 'trasporto', 'FirmaProduttoreTrasportatoreIniziale'],
  ])('da %s, completata `%s`, il formulario passa a %s', async (partenza, segmento, atteso) => {
    const app = creaApp()
    await seminaFormulario(app, partenza)
    const corpo = segmento === 'quantita' ? corpoQuantitaValido() : corpoTrasportoTerrestreValido()

    await completa(app, await avvia(app, segmento, corpo))

    expect(await stato(app)).toBe(atteso)
  })

  it.each([
    ['FirmaProduttoreTrasportatoreIniziale', 'quantita', corpoQuantitaValido],
    ['FirmaProduttoreTrasportatoreIniziale', 'trasporto', corpoTrasportoTerrestreValido],
  ])('la correzione in %s (%s) non cambia lo stato', async (partenza, segmento, corpo) => {
    const app = creaApp()
    await seminaFormulario(app, partenza)

    await completa(app, await avvia(app, segmento, corpo()))

    expect(await stato(app)).toBe(partenza)
  })
})

describe('Firme di partenza: acquisizione-firma nella fase iniziale (FIR in viaggio, P3)', () => {
  async function firma(app: ReturnType<typeof creaApp>): Promise<void> {
    const avvio = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/acquisizione-firma`,
      headers: await intestazioniAutenticate(),
      payload: { certificato: 'c', token: 't', firma: 'f' },
    })
    expect(avvio.statusCode).toBe(202)
    const esito = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: avvio.json().transazione_id, errore: false },
    })
    expect(esito.statusCode).toBe(200)
  }

  async function stato(app: ReturnType<typeof creaApp>): Promise<string> {
    const risposta = await app.inject({
      method: 'GET',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/stato`,
      headers: await intestazioniAutenticate(),
    })
    return risposta.json().stato_formulario as string
  }

  // Ipotesi dedotta dai NOMI degli stati (FEDELTA.md §8.2): da verificare sulla demo.
  it.each([
    ['FirmaProduttoreTrasportatoreIniziale', 'InserimentoAccettazione'],
    ['FirmaTrasportatoreIniziale', 'InserimentoAccettazione'],
    ['FirmaProduttore', 'FirmaTrasportatoreIniziale'],
  ])('da %s, acquisita la firma, il formulario passa a %s', async (partenza, atteso) => {
    const app = creaApp()
    await seminaFormulario(app, partenza)

    await firma(app)

    expect(await stato(app)).toBe(atteso)
  })

  it('dopo la firma di partenza il rollback-firma riporta alla firma precedente', async () => {
    const app = creaApp()
    await seminaFormulario(app, 'FirmaProduttoreTrasportatoreIniziale')
    await firma(app)

    const avvio = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/rollback-firma`,
      headers: await intestazioniAutenticate(),
    })
    expect(avvio.statusCode).toBe(202)
    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: avvio.json().transazione_id, errore: false },
    })

    expect(await stato(app)).toBe('FirmaProduttoreTrasportatoreIniziale')
  })

  it("una firma rifiutata dall'ente lascia lo stato invariato", async () => {
    const app = creaApp()
    await seminaFormulario(app, 'FirmaProduttoreTrasportatoreIniziale')
    const avvio = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/acquisizione-firma`,
      headers: await intestazioniAutenticate(),
      payload: { certificato: 'c', token: 't', firma: 'f' },
    })
    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: avvio.json().transazione_id, errore: true },
    })

    expect(await stato(app)).toBe('FirmaProduttoreTrasportatoreIniziale')
  })
})

describe('Annotazione: FirmaAnnotazione e ritorno allo stato di prima (FIR in viaggio, P4)', () => {
  const CORPO = { annotazione: 'Carico pesato due volte', identificativo_soggetto: '01234567897' }

  async function completa(
    app: ReturnType<typeof creaApp>,
    segmento: string,
    corpo: Record<string, unknown>,
    errore = false
  ): Promise<void> {
    const avvio = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/${segmento}`,
      headers: await intestazioniAutenticate(),
      payload: corpo,
    })
    expect(avvio.statusCode).toBe(202)
    const esito = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: avvio.json().transazione_id, errore },
    })
    expect(esito.statusCode).toBe(200)
  }

  async function stato(app: ReturnType<typeof creaApp>): Promise<string> {
    const risposta = await app.inject({
      method: 'GET',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/stato`,
      headers: await intestazioniAutenticate(),
    })
    return risposta.json().stato_formulario as string
  }

  const FIRMA = { certificato: 'c', token: 't', firma: 'f' }

  it.each(['InserimentoAccettazione', 'Accettato', 'RespintoAccettatoParzialmente'])(
    'da %s: annotazione -> FirmaAnnotazione -> firma -> stato di prima',
    async partenza => {
      const app = creaApp()
      await seminaFormulario(app, partenza)

      await completa(app, 'annotazione', CORPO)
      expect(await stato(app)).toBe('FirmaAnnotazione')

      await completa(app, 'acquisizione-firma', FIRMA)
      expect(await stato(app)).toBe(partenza)
    }
  )

  it("un'annotazione rifiutata dall'ente lascia lo stato invariato", async () => {
    const app = creaApp()
    await seminaFormulario(app, 'InserimentoAccettazione')

    await completa(app, 'annotazione', CORPO, true)

    expect(await stato(app)).toBe('InserimentoAccettazione')
  })

  it("una firma rifiutata lascia FirmaAnnotazione; il reset annulla l'annotazione non firmata", async () => {
    const app = creaApp()
    await seminaFormulario(app, 'InserimentoAccettazione')
    await completa(app, 'annotazione', CORPO)

    await completa(app, 'acquisizione-firma', FIRMA, true)
    expect(await stato(app)).toBe('FirmaAnnotazione')

    await completa(app, 'reset', {})
    expect(await stato(app)).toBe('InserimentoAccettazione')
  })

  async function annotazioni(app: ReturnType<typeof creaApp>): Promise<unknown> {
    const risposta = await app.inject({
      method: 'GET',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}`,
      headers: await intestazioniAutenticate(),
    })
    return risposta.json().dati_annotazioni
  }

  it('il dettaglio (GET /{numero_fir}) espone le annotazioni: non firmata, firmata, annullata dal reset', async () => {
    const app = creaApp()
    await seminaFormulario(app, 'InserimentoAccettazione')

    await completa(app, 'annotazione', CORPO)
    expect(await annotazioni(app)).toEqual([{ ...CORPO, dati_firma: null }])

    await completa(app, 'acquisizione-firma', FIRMA)
    expect(await annotazioni(app)).toEqual([
      { ...CORPO, dati_firma: expect.objectContaining({ data_firma: expect.any(String) }) },
    ])

    const seconda = { ...CORPO, annotazione: 'Seconda annotazione' }
    await completa(app, 'annotazione', seconda)
    expect(await annotazioni(app)).toHaveLength(2)
    await completa(app, 'reset', {})
    expect(await annotazioni(app)).toEqual([
      { ...CORPO, dati_firma: expect.objectContaining({ data_firma: expect.any(String) }) },
    ])
  })

  it("un'annotazione senza identificativo_soggetto e respinta dal contratto (400)", async () => {
    const app = creaApp()
    await seminaFormulario(app, 'InserimentoAccettazione')

    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/annotazione`,
      headers: await intestazioniAutenticate(),
      payload: { annotazione: 'x' },
    })

    expect(risposta.statusCode).toBe(400)
  })
})

describe('Sosta tecnica: FirmaSostaTecnica e ritorno allo stato di prima (FIR in viaggio, P5)', () => {
  const CORPO = corpoSostaTecnicaValido()
  const FIRMA = { certificato: 'c', token: 't', firma: 'f' }

  async function completa(
    app: ReturnType<typeof creaApp>,
    segmento: string,
    corpo: Record<string, unknown>,
    errore = false
  ): Promise<void> {
    const avvio = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/${segmento}`,
      headers: await intestazioniAutenticate(),
      payload: corpo,
    })
    expect(avvio.statusCode).toBe(202)
    const esito = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: avvio.json().transazione_id, errore },
    })
    expect(esito.statusCode).toBe(200)
  }

  async function stato(app: ReturnType<typeof creaApp>): Promise<string> {
    const risposta = await app.inject({
      method: 'GET',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/stato`,
      headers: await intestazioniAutenticate(),
    })
    return risposta.json().stato_formulario as string
  }

  async function dettaglio(app: ReturnType<typeof creaApp>): Promise<Record<string, unknown>> {
    const risposta = await app.inject({
      method: 'GET',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}`,
      headers: await intestazioniAutenticate(),
    })
    return risposta.json()
  }

  it.each(['InserimentoAccettazione', 'InserimentoTrasportoSuccessivo'])(
    'da %s: sosta -> FirmaSostaTecnica -> firma -> stato di prima',
    async partenza => {
      const app = creaApp()
      await seminaFormulario(app, partenza)

      await completa(app, 'sosta-tecnica', CORPO)
      expect(await stato(app)).toBe('FirmaSostaTecnica')

      await completa(app, 'acquisizione-firma', FIRMA)
      expect(await stato(app)).toBe(partenza)
    }
  )

  it('il dettaglio espone dati_soste_tecniche: non firmata, firmata, annullata dal reset', async () => {
    const app = creaApp()
    await seminaFormulario(app, 'InserimentoAccettazione')

    await completa(app, 'sosta-tecnica', CORPO)
    expect((await dettaglio(app)).dati_soste_tecniche).toEqual([{ ...CORPO, dati_firma: null }])

    await completa(app, 'acquisizione-firma', FIRMA)
    expect((await dettaglio(app)).dati_soste_tecniche).toEqual([
      { ...CORPO, dati_firma: expect.objectContaining({ data_firma: expect.any(String) }) },
    ])

    await completa(app, 'sosta-tecnica', {
      ...CORPO,
      luogo_stazionamento: 'Seconda sosta',
    })
    expect((await dettaglio(app)).dati_soste_tecniche).toHaveLength(2)
    await completa(app, 'reset', {})
    expect((await dettaglio(app)).dati_soste_tecniche).toEqual([
      { ...CORPO, dati_firma: expect.objectContaining({ data_firma: expect.any(String) }) },
    ])
  })

  it("una sosta rifiutata dall'ente non lascia traccia; una firma rifiutata lascia FirmaSostaTecnica", async () => {
    const app = creaApp()
    await seminaFormulario(app, 'InserimentoAccettazione')

    await completa(app, 'sosta-tecnica', CORPO, true)
    expect(await stato(app)).toBe('InserimentoAccettazione')

    await completa(app, 'sosta-tecnica', CORPO)
    await completa(app, 'acquisizione-firma', FIRMA, true)
    expect(await stato(app)).toBe('FirmaSostaTecnica')
  })

  it('il rollback-firma riporta la sosta a non firmata e a FirmaSostaTecnica', async () => {
    const app = creaApp()
    await seminaFormulario(app, 'InserimentoAccettazione')
    await completa(app, 'sosta-tecnica', CORPO)
    await completa(app, 'acquisizione-firma', FIRMA)

    await completa(app, 'rollback-firma', {})

    expect(await stato(app)).toBe('FirmaSostaTecnica')
    expect((await dettaglio(app)).dati_soste_tecniche).toEqual([{ ...CORPO, dati_firma: null }])
  })

  it('una sosta con la ripresa prima della sospensione e respinta (400)', async () => {
    const app = creaApp()
    await seminaFormulario(app, 'InserimentoAccettazione')
    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/sosta-tecnica`,
      headers: await intestazioniAutenticate(),
      payload: { ...CORPO, data_ora_ripresa: '2026-11-18T09:00:00Z' },
    })
    expect(risposta.statusCode).toBe(400)
  })
})

describe('POST / : stato iniziale dedotto da quantita e trasporto di partenza (FIR in viaggio, P2)', () => {
  async function crea(corpo: Record<string, unknown>): Promise<string> {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: `${PREFISSO}/`,
      headers: await intestazioniAutenticate(),
      payload: corpo,
    })
    expect(risposta.statusCode).toBe(202)
    const id = risposta.json().transazione_id as string
    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: {
        transazione_id: id,
        errore: false,
        esito: { numero_fir: NUMERO_FIR_VIAGGIO },
      },
    })
    const stato = await app.inject({
      method: 'GET',
      url: `${PREFISSO}/${NUMERO_FIR_VIAGGIO}/stato`,
      headers: await intestazioniAutenticate(),
    })
    return stato.json().stato_formulario as string
  }

  const base = (): Record<string, unknown> => ({
    num_iscr_sito: 'OP1234ABC000001-AB0001',
    dati_partenza: {
      destinatario: { num_iscr_sito: 'OP1234ABC000002-AB0002' },
      trasportatori: [{ num_iscr_sito: 'OP1234ABC000003-AB0003', tipo_trasporto: 'Terrestre' }],
      rifiuto: { codice_eer: '150106', provenienza: 'S', stato_fisico: 'S' },
    },
  })

  const conQuantita = (corpo: Record<string, unknown>): Record<string, unknown> => {
    const partenza = corpo.dati_partenza as { rifiuto: Record<string, unknown> }
    partenza.rifiuto = { ...partenza.rifiuto, ...corpoQuantitaValido() }
    return corpo
  }

  it('con quantita e trasporto: gia in attesa di firma', async () => {
    const corpo = conQuantita(base())
    corpo.dati_trasporto_partenza = corpoTrasportoTerrestreValido()
    expect(await crea(corpo)).toBe('FirmaProduttoreTrasportatoreIniziale')
  })

  it('con la sola quantita: manca il trasporto', async () => {
    expect(await crea(conQuantita(base()))).toBe('InserimentoTrasportoIniziale')
  })

  it('con il solo trasporto: manca la quantita', async () => {
    const corpo = base()
    corpo.dati_trasporto_partenza = corpoTrasportoTerrestreValido()
    expect(await crea(corpo)).toBe('InserimentoQuantita')
  })
})
