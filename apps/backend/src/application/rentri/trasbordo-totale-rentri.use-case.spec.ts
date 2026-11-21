import { FIR, ParteFIR } from '../../domain/fir/aggregates/fir.aggregate'
import { TrasmissioneRentriIncertaError } from '../../infrastructure/rentri/rentri-api.client'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'
import { DatiViaggioFirInMemoria } from './dati-viaggio-fir.in-memoria'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'
import {
  TrasbordoTotaleRentriUseCase,
  tipoOperazioneTrasbordoTotale,
  tipoPrenotazioneInvioTrasbordoTotale,
} from './trasbordo-totale-rentri.use-case'

/**
 * FIR in viaggio P6 — trasbordo totale: il trasportatore che ha in carico il rifiuto lo passa a un NUOVO
 * trasportatore (da anagrafica) con i suoi dati di trasporto. Disponibilita' decisa da `/azioni`. **Nessuna
 * tratta locale** (nuova `FIRTransporter`) finche' l'ente non ha accettato: se rifiuta, o se l'esito e' incerto,
 * la tratta non nasce. La firma e' del NUOVO trasportatore. Stesse difese di P4/P5: prenotazione dell'invio,
 * riga INVIATA prima del POST, POST mai ritentato, riconciliazione di un esito ignoto.
 */
describe('TrasbordoTotaleRentriUseCase', () => {
  const TENANT = 'tenant-p6-1'
  const FIR_ID = 'fir-p6-1'
  const NUMERO_FIR = 'BCDFGH00061ZH'
  const CF_TENANT = '01234567897'
  const CF_NUOVO = '01234567890'
  const NUOVO_ID = 'tr-nuovo'
  const INIZIO = '2026-11-18T12:00:00.000Z'
  const CORPO = {
    trasportatore: {
      denominazione: 'Trasporti Verdi Srl',
      codice_fiscale: CF_NUOVO,
      tipo_trasporto: 'Terrestre',
      numero_iscrizione_albo: 'MI/007490',
    },
    presa_in_carico: {
      data_ora_inizio_trasporto: INIZIO,
      conducente: { nome: 'Luca', cognome: 'Bianchi' },
      targa_automezzo: 'FG456HI',
    },
  }

  const parte = (partitaIva: string, codiceFiscale?: string): ParteFIR => ({
    ragioneSociale: 'Ditta',
    partitaIva,
    ...(codiceFiscale && { codiceFiscale }),
  })

  function creaFir(
    opzioni: {
      legato?: boolean
      trasportatore?: ParteFIR
      aggiuntivi?: { partitaIva?: string; codiceFiscale?: string }[]
    } = {}
  ): FIR {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT,
      rifiuto: { cerCode: '150101', quantita: 10 },
      produttore: parte('33333333335'),
      trasportatore: opzioni.trasportatore ?? parte(CF_TENANT),
      destinatario: parte('22222222226'),
      trasportatoriAggiuntivi: (opzioni.aggiuntivi ?? []).map((a, i) => ({
        ordine: i + 2,
        tipoTratta: 'TERRESTRE' as any,
        denominazione: 'Altro',
        ...a,
      })),
    })
    Object.assign(fir, { _id: FIR_ID })
    fir.emetti('FIR-P6-000001', { firmatario: 'X', timestamp: new Date(), certificato: 'c' })
    if (opzioni.legato !== false) fir.markRENTRISynced(NUMERO_FIR)
    return fir
  }

  const anagrafica = (cf = CF_NUOVO, id = NUOVO_ID) => ({
    id,
    ragioneSociale: 'Trasporti Verdi Srl',
    partitaIVA: { getValue: () => cf },
    codiceFiscale: undefined,
    numeroIscrizione: 'MI/7490',
  })

  function ambiente(
    opzioni: {
      fir?: FIR
      azioni?: string[]
      esito?: Record<string, unknown>
      cfTenant?: string | null
      moduli?: string[]
      firma?: unknown
      /** `dati_trasbordo_totale` del dettaglio dell'ente (default: rispecchia lo storico). */
      trasbordo?: unknown
      trasportatore?: unknown
    } = {}
  ) {
    const fir = opzioni.fir ?? creaFir()
    const eventi = new EventiFirRentriInMemoria()
    const sessioni = new SessioniFirmaRentriInMemoria()
    const datiViaggio = new DatiViaggioFirInMemoria()
    datiViaggio.righe.set(FIR_ID, {
      firId: FIR_ID,
      dichiarato: null,
      quantita: 10,
      unitaMisura: 'kg',
      numeroColli: null,
      verificatoInPartenza: null,
      rinfusa: null,
      dataTrasporto: new Date('2026-11-18T08:00:00Z'),
      targaAutomezzo: '',
      principale: {
        conducenteNome: null,
        conducenteCognome: null,
        targaRimorchio: null,
        percorso: null,
      },
      tratteAggiuntive: [],
    })
    const firRepository = { findById: jest.fn().mockResolvedValue(fir), save: jest.fn() }
    const getAzioni = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({
          azioni: (opzioni.azioni ?? ['TrasbordoTotale']).map(operazione => ({ operazione })),
        })
        .mockResolvedValue({
          azioni: [{ operazione: 'AcquisizioneFirmaTrasbordoTotale' }, { operazione: 'Reset' }],
        }),
    }
    const completa = {
      execute: jest
        .fn()
        .mockResolvedValue(
          opzioni.firma ?? { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' }
        ),
    }
    function trasbordoDaStorico() {
      const accettata = eventi.righe
        .slice()
        .reverse()
        .find(r => r.operazione === 'TrasbordoTotale' && r.esito === 'ACCETTATA')
      if (!accettata) return undefined
      const p = accettata.payload as typeof CORPO
      return {
        trasportatore: p.trasportatore,
        presa_in_carico: {
          ...p.presa_in_carico,
          dati_firma_trasportatore:
            completa.execute.mock.calls.length > 0 ? { data_firma: '2026-11-20T10:00:00Z' } : null,
        },
      }
    }
    const client = {
      inviaTrasbordoTotale: jest
        .fn()
        .mockResolvedValue(
          opzioni.esito ?? { errore: false, validazione: [], transazioneId: 'tr-tt-1' }
        ),
      leggiStato: jest
        .fn()
        .mockResolvedValue({ versione: 3, stato_formulario: 'FirmaTrasbordoTotale' }),
      leggiFormulario: jest.fn().mockImplementation(async () => ({
        stato_formulario: 'FirmaTrasbordoTotale',
        dati_trasbordo_totale:
          opzioni.trasbordo === undefined ? trasbordoDaStorico() : opzioni.trasbordo,
      })),
      leggiStatoTransazione: jest.fn().mockResolvedValue({ stato: 'NON_TROVATA' }),
    }
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          codiceFiscale: opzioni.cfTenant === undefined ? CF_TENANT : opzioni.cfTenant,
        }),
      },
    }
    const moduli = {
      moduliAttivi: jest.fn().mockResolvedValue(opzioni.moduli ?? ['fir', 'rentri']),
    }
    const trasportatori = {
      findById: jest
        .fn()
        .mockResolvedValue(
          opzioni.trasportatore === undefined ? anagrafica() : opzioni.trasportatore
        ),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const useCase = new TrasbordoTotaleRentriUseCase(
      firRepository as any,
      getAzioni as any,
      client as any,
      completa as any,
      eventi,
      logger,
      sessioni,
      moduli as any,
      prisma as any,
      trasportatori as any,
      datiViaggio
    )
    return {
      useCase,
      fir,
      eventi,
      sessioni,
      datiViaggio,
      firRepository,
      getAzioni,
      client,
      completa,
      trasportatori,
      logger,
    }
  }

  const comando = (extra: Record<string, unknown> = {}) => ({
    firId: FIR_ID,
    tenantId: TENANT,
    trasportatoreId: NUOVO_ID,
    conducenteNome: 'Luca',
    conducenteCognome: 'Bianchi',
    targaAutomezzo: 'fg456hi',
    dataOraInizioTrasporto: INIZIO,
    utenteId: 'u1',
    ...extra,
  })

  async function nessunaRete(a: ReturnType<typeof ambiente>) {
    expect(a.getAzioni.execute).not.toHaveBeenCalled()
    expect(a.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
    expect(a.completa.execute).not.toHaveBeenCalled()
    expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(0)
    expect(a.datiViaggio.scritture).toEqual([])
  }

  async function trasbordoNostroInSospeso(a: ReturnType<typeof ambiente>, corpo = CORPO) {
    await a.eventi.registra({
      tenantId: TENANT,
      firId: FIR_ID,
      operazione: 'TrasbordoTotale',
      payload: corpo,
      transazioneId: 'tr-sospeso',
      esito: 'ACCETTATA',
      dettaglioEnte: null,
      statoFormularioDopo: 'FirmaTrasbordoTotale',
      utenteId: 'u1',
    })
  }

  async function esitiTrasbordo(a: ReturnType<typeof ambiente>) {
    const tutte = await a.eventi.elenca(TENANT, FIR_ID)
    return tutte
      .filter(r => r.operazione === 'TrasbordoTotale')
      .map(r => r.esito)
      .reverse()
  }

  describe('invia: precondizioni locali (prima di qualunque rete)', () => {
    it('FIR inesistente: 404; di un altro tenant: non autorizzato', async () => {
      const a = ambiente()
      a.firRepository.findById.mockResolvedValue(null)
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({ code: 'NOT_FOUND' })
      const b = ambiente()
      await expect(b.useCase.invia(comando({ tenantId: 'altro' }))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
      await nessunaRete(a)
      await nessunaRete(b)
    })

    it('FIR non legato: FIR_NON_LEGATO_RENTRI; modulo spento: MODULO_NON_ATTIVO', async () => {
      const a = ambiente({ fir: creaFir({ legato: false }) })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIR_NON_LEGATO_RENTRI' }),
      })
      const b = ambiente({ moduli: ['fir'] })
      await expect(b.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'MODULO_NON_ATTIVO' }),
      })
      await nessunaRete(a)
      await nessunaRete(b)
    })

    it("nuovo trasportatore non in anagrafica (o di un'altra azienda): 404, nessuna rete", async () => {
      const a = ambiente({ trasportatore: null })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await nessunaRete(a)
    })

    it.each([
      ['conducente senza nome', { conducenteNome: '  ' }],
      ['conducente senza cognome', { conducenteCognome: '' }],
      ['nessuna targa', { targaAutomezzo: undefined }],
      ['inizio senza fuso orario', { dataOraInizioTrasporto: '2026-11-18T12:00:00' }],
      ['inizio non una data', { dataOraInizioTrasporto: 'domani' }],
      ['percorso oltre 250 caratteri', { percorso: 'x'.repeat(251) }],
    ])('dati non validi (%s): TRASBORDO_TOTALE_NON_VALIDO, nessuna rete', async (_n, extra) => {
      const a = ambiente()
      await expect(a.useCase.invia(comando(extra))).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_NON_VALIDO' }),
      })
      await nessunaRete(a)
    })

    it('nuovo trasportatore senza partita IVA ne codice fiscale: TRASBORDO_TOTALE_NON_VALIDO', async () => {
      const a = ambiente({
        trasportatore: { ...anagrafica(), partitaIVA: null, codiceFiscale: undefined },
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_NON_VALIDO' }),
      })
      await nessunaRete(a)
    })

    it('CF del tenant mancante: CF_TENANT_MANCANTE; non fra i trasportatori del FIR: SOGGETTO_NON_NEL_FIR', async () => {
      const a = ambiente({ cfTenant: null })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'CF_TENANT_MANCANTE' }),
      })
      const b = ambiente({ cfTenant: '99999999999' })
      await expect(b.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_SOGGETTO_NON_NEL_FIR' }),
      })
      await nessunaRete(a)
      await nessunaRete(b)
    })

    it('il tenant puo essere un trasportatore aggiuntivo del FIR', async () => {
      const a = ambiente({
        fir: creaFir({
          trasportatore: parte('55555555555'),
          aggiuntivi: [{ partitaIva: CF_TENANT }],
        }),
      })
      await a.useCase.invia(comando())
      expect(a.client.inviaTrasbordoTotale).toHaveBeenCalledTimes(1)
    })

    it('trasbordo verso se stessi o verso chi ha gia in carico il rifiuto: non valido, nessuna rete', async () => {
      const aSeStessi = ambiente({ trasportatore: anagrafica(CF_TENANT) })
      await expect(aSeStessi.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_NON_VALIDO' }),
      })
      await nessunaRete(aSeStessi)

      // L'ultimo trasportatore del FIR (quello in carico) e' gia' il nuovo.
      const aChiHaInCarico = ambiente({
        fir: creaFir({ aggiuntivi: [{ partitaIva: CF_NUOVO }] }),
      })
      await expect(aChiHaInCarico.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_NON_VALIDO' }),
      })
      await nessunaRete(aChiHaInCarico)
    })
  })

  describe('invia: /azioni decide', () => {
    it('senza TrasbordoTotale fra le azioni: OPERAZIONE_NON_DISPONIBILE, nessun POST, nessuna riga INVIATA', async () => {
      const a = ambiente({ azioni: ['Annotazione'] })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'OPERAZIONE_NON_DISPONIBILE' }),
      })
      expect(a.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
      expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(0)
    })

    it('firma di un trasbordo in attesa: nostro = DA_FIRMARE, di altri = DI_ALTRO_SOGGETTO, mai un secondo POST', async () => {
      const nostro = ambiente({ azioni: ['AcquisizioneFirmaTrasbordoTotale'] })
      await trasbordoNostroInSospeso(nostro)
      await expect(nostro.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_DA_FIRMARE' }),
      })
      const altrui = ambiente({ azioni: ['AcquisizioneFirmaTrasbordoTotale'] })
      await expect(altrui.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_DI_ALTRO_SOGGETTO' }),
      })
      expect(nostro.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
      expect(altrui.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
    })
  })

  describe('invia: percorso felice e T1 — la tratta locale nasce SOLO dopo l’esito positivo', () => {
    it('INVIATA prima del POST, corpo del contratto, stato riletto, ACCETTATA, poi la tratta locale', async () => {
      const a = ambiente()
      const ordine: string[] = []
      a.client.inviaTrasbordoTotale.mockImplementation(async () => {
        ordine.push(`POST dopo ${(await a.eventi.elenca(TENANT, FIR_ID)).map(e => e.esito).join()}`)
        expect(a.datiViaggio.scritture).toEqual([]) // nessuna tratta prima dell'esito
        return { errore: false, validazione: [], transazioneId: 'tr-tt-1' }
      })

      const esito = await a.useCase.invia(comando())

      expect(ordine).toEqual(['POST dopo INVIATA'])
      expect(a.client.inviaTrasbordoTotale).toHaveBeenCalledWith(TENANT, NUMERO_FIR, CORPO)
      expect(a.getAzioni.execute).toHaveBeenCalledTimes(1)
      expect(await esitiTrasbordo(a)).toEqual(['INVIATA', 'ACCETTATA'])
      expect(a.datiViaggio.scritture).toEqual(['aggiungiTrattaTrasbordoTotale'])
      expect(a.datiViaggio.righe.get(FIR_ID)?.tratteAggiuntive).toEqual([
        expect.objectContaining({
          ordine: 2,
          tipoTratta: 'TERRESTRE',
          denominazione: 'Trasporti Verdi Srl',
          partitaIva: CF_NUOVO,
          mezzo: 'FG456HI',
          conducenteNome: 'Luca',
          conducenteCognome: 'Bianchi',
          dataOraInizioTrasporto: new Date(INIZIO),
        }),
      ])
      // La firma e' del NUOVO trasportatore: da qui non si chiede nessuna firma.
      expect(a.completa.execute).not.toHaveBeenCalled()
      expect(esito).toEqual({
        operazione: 'TrasbordoTotale',
        statoFormulario: 'FirmaTrasbordoTotale',
        trattaLocaleCreata: true,
        firma: { esito: 'DA_FIRMARE_DAL_NUOVO_TRASPORTATORE', avviso: expect.any(String) },
      })
      // Stato salvato sul FIR dopo l'ente.
      expect(a.firRepository.save).toHaveBeenCalled()
    })

    it("l'ente rifiuta con errore di validazione: RIFIUTATA, NESSUNA tratta locale", async () => {
      const a = ambiente({
        esito: { errore: true, validazione: [{ campo: 'x' }], transazioneId: 'tr-no' },
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_RENTRI_RIFIUTATO' }),
      })
      expect(await esitiTrasbordo(a)).toEqual(['INVIATA', 'RIFIUTATA'])
      expect(a.datiViaggio.scritture).toEqual([])
      expect(a.datiViaggio.righe.get(FIR_ID)?.tratteAggiuntive).toEqual([])
    })

    it("l'ente rifiuta con 4xx (403/400): RIFIUTATA, nessuna tratta locale", async () => {
      const a = ambiente()
      a.client.inviaTrasbordoTotale.mockRejectedValue(
        new RentriApiError(403, 'Operazione non consentita', undefined, false)
      )
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_RENTRI_RIFIUTATO' }),
      })
      expect(await esitiTrasbordo(a)).toEqual(['INVIATA', 'RIFIUTATA'])
      expect(a.datiViaggio.scritture).toEqual([])
    })

    it.each([
      [
        'esito incerto del client (5xx, polling esaurito)',
        () =>
          new TrasmissioneRentriIncertaError(
            'ESITO_NON_DISPONIBILE',
            undefined,
            'trasbordo totale',
            'tr-x'
          ),
      ],
      ['errore di rete generico', () => new Error('ECONNRESET')],
    ])(
      '%s: INCERTA, errore dedicato TRASBORDO_TOTALE_ESITO_INCERTO (non un 500), NESSUNA tratta locale',
      async (_n, errore) => {
        const a = ambiente()
        a.client.inviaTrasbordoTotale.mockRejectedValue(errore())

        await expect(a.useCase.invia(comando())).rejects.toMatchObject({
          code: 'BUSINESS_RULE_VIOLATION',
          metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_ESITO_INCERTO' }),
        })

        expect(a.client.inviaTrasbordoTotale).toHaveBeenCalledTimes(1) // mai ritentato
        expect(await esitiTrasbordo(a)).toEqual(['INVIATA', 'INCERTA'])
        expect(a.datiViaggio.scritture).toEqual([])
        expect(a.datiViaggio.righe.get(FIR_ID)?.tratteAggiuntive).toEqual([])
      }
    )

    it("l'incerta conserva il transazione_id noto nella riga, per la riconciliazione", async () => {
      const a = ambiente()
      a.client.inviaTrasbordoTotale.mockRejectedValue(
        new TrasmissioneRentriIncertaError(
          'ESITO_NON_DISPONIBILE',
          undefined,
          'trasbordo totale',
          'tr-x'
        )
      )
      await a.useCase.invia(comando()).catch(() => undefined)
      const righe = await a.eventi.elenca(TENANT, FIR_ID)
      expect(righe[0]).toMatchObject({ esito: 'INCERTA', transazioneId: 'tr-x' })
    })

    it("la scrittura della tratta fallisce DOPO l'ente: ACCETTATA resta, trattaLocaleCreata false e avviso nello storico, nessun errore", async () => {
      const a = ambiente()
      jest
        .spyOn(a.datiViaggio, 'aggiungiTrattaTrasbordoTotale')
        .mockRejectedValue(new Error('db giu'))

      const esito = await a.useCase.invia(comando())

      expect(esito.trattaLocaleCreata).toBe(false)
      expect(esito.statoFormulario).toBe('FirmaTrasbordoTotale')
      const accettata = (await a.eventi.elenca(TENANT, FIR_ID)).find(e => e.esito === 'ACCETTATA')
      expect(accettata?.dettaglioEnte).toMatch(/tratta locale/i)
    })

    it('la rilettura dello stato fallisce: l operazione e comunque riuscita (stato null, tratta creata)', async () => {
      const a = ambiente()
      a.client.leggiStato.mockRejectedValue(new Error('rete'))
      const esito = await a.useCase.invia(comando())
      expect(esito.statoFormulario).toBeNull()
      expect(esito.trattaLocaleCreata).toBe(true)
      expect(await esitiTrasbordo(a)).toEqual(['INVIATA', 'ACCETTATA'])
    })

    it('non scrive la riga INVIATA: il POST non parte', async () => {
      const a = ambiente()
      jest.spyOn(a.eventi, 'registra').mockRejectedValueOnce(new Error('storico giu'))
      await expect(a.useCase.invia(comando())).rejects.toThrow('storico giu')
      expect(a.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
      expect(a.datiViaggio.scritture).toEqual([])
    })

    it('due invii concorrenti: un solo POST, l’altro SESSIONE_FIRMA_IN_CORSO; la prenotazione si rilascia', async () => {
      const a = ambiente()
      let sblocca: (v: unknown) => void = () => undefined
      a.client.inviaTrasbordoTotale.mockImplementation(
        () => new Promise(resolve => (sblocca = resolve))
      )
      const primo = a.useCase.invia(comando())
      await new Promise(r => setImmediate(r))
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
      sblocca({ errore: false, validazione: [], transazioneId: 'tr-1' })
      await primo
      expect(a.client.inviaTrasbordoTotale).toHaveBeenCalledTimes(1)
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it('una sessione di firma gia aperta blocca l invio (409), senza rete', async () => {
      const a = ambiente()
      await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: 'ACCETTAZIONE',
        scadenza: new Date(Date.now() + 60_000),
        utenteId: 'u1',
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
      expect(a.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
    })
  })

  describe('riconciliazione di un invio rimasto senza esito', () => {
    async function invioSenzaEsito(
      a: ReturnType<typeof ambiente>,
      esito: 'INVIATA' | 'INCERTA',
      transazioneId: string | null,
      etaMs = 0
    ) {
      await a.eventi.registra({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'TrasbordoTotale',
        payload: CORPO,
        transazioneId,
        esito,
        dettaglioEnte: null,
        statoFormularioDopo: null,
        utenteId: 'u1',
      })
      if (etaMs) {
        const riga = a.eventi.righe[a.eventi.righe.length - 1]
        ;(riga as any).createdAt = new Date(Date.now() - etaMs)
      }
    }

    const presenteNonFirmato = {
      trasportatore: CORPO.trasportatore,
      presa_in_carico: { ...CORPO.presa_in_carico, dati_firma_trasportatore: null },
    }

    it("l'ente mostra il nostro trasbordo: ACCETTATA «riconciliata» e la tratta locale nasce (una volta sola), senza un secondo POST", async () => {
      const a = ambiente({ trasbordo: presenteNonFirmato, azioni: ['TrasbordoTotale'] })
      await invioSenzaEsito(a, 'INCERTA', 'tr-x')

      // Il nuovo invio e' rifiutato da /azioni perche' ora c'e' la firma da fare: prima pero' si riconcilia.
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaTrasbordoTotale' }],
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_DA_FIRMARE' }),
      })

      expect(a.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
      expect(await esitiTrasbordo(a)).toEqual(['INCERTA', 'ACCETTATA'])
      const acc = (await a.eventi.elenca(TENANT, FIR_ID)).find(e => e.esito === 'ACCETTATA')
      expect(acc?.dettaglioEnte).toMatch(/riconciliata/)
      expect(a.datiViaggio.righe.get(FIR_ID)?.tratteAggiuntive).toHaveLength(1)

      // Riconciliare ancora (firma) non duplica la tratta.
      await a.useCase.firma({ firId: FIR_ID, tenantId: TENANT }).catch(() => undefined)
      expect(a.datiViaggio.righe.get(FIR_ID)?.tratteAggiuntive).toHaveLength(1)
    })

    it("non c'e' presso l'ente, dentro la finestra: IN_VERIFICA, nessun POST, nessuna tratta", async () => {
      const a = ambiente({ trasbordo: null })
      await invioSenzaEsito(a, 'INCERTA', null)
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_IN_VERIFICA' }),
      })
      expect(a.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
      expect(a.datiViaggio.scritture).toEqual([])
    })

    it('transazione ancora in elaborazione: IN_VERIFICA', async () => {
      const a = ambiente({ trasbordo: null })
      await invioSenzaEsito(a, 'INCERTA', 'tr-x', 24 * 3600_000)
      a.client.leggiStatoTransazione.mockResolvedValue({ stato: 'IN_ELABORAZIONE' })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_IN_VERIFICA' }),
      })
      expect(a.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
    })

    it("non c'e' presso l'ente e la finestra e passata: RIFIUTATA «non risulta», nessuna tratta, e il nuovo invio parte", async () => {
      const a = ambiente({ trasbordo: null })
      await invioSenzaEsito(a, 'INVIATA', null, 24 * 3600_000)

      await a.useCase.invia(comando())

      expect(await esitiTrasbordo(a)).toEqual(['INVIATA', 'RIFIUTATA', 'INVIATA', 'ACCETTATA'])
      expect(a.client.inviaTrasbordoTotale).toHaveBeenCalledTimes(1)
      // La tratta nasce una volta sola, dal nuovo invio.
      expect(a.datiViaggio.righe.get(FIR_ID)?.tratteAggiuntive).toHaveLength(1)
    })

    it("un trasbordo diverso presso l'ente (altro trasportatore) non e il nostro: non si adotta", async () => {
      const a = ambiente({
        trasbordo: {
          trasportatore: { ...CORPO.trasportatore, codice_fiscale: '99999999999' },
          presa_in_carico: { ...CORPO.presa_in_carico, dati_firma_trasportatore: null },
        },
      })
      await invioSenzaEsito(a, 'INCERTA', null)
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_IN_VERIFICA' }),
      })
      expect(a.datiViaggio.scritture).toEqual([])
    })

    it('un errore nel leggere il dettaglio dell’ente si propaga (fail-closed)', async () => {
      const a = ambiente()
      await invioSenzaEsito(a, 'INCERTA', null)
      a.client.leggiFormulario.mockRejectedValue(new Error('rete'))
      await expect(a.useCase.invia(comando())).rejects.toThrow('rete')
      expect(a.client.inviaTrasbordoTotale).not.toHaveBeenCalled()
    })
  })

  describe('firma: spetta al NUOVO trasportatore', () => {
    const dellEnte = (cfNuovo: string, firmato = false) => ({
      trasportatore: { ...CORPO.trasportatore, codice_fiscale: cfNuovo },
      presa_in_carico: {
        ...CORPO.presa_in_carico,
        dati_firma_trasportatore: firmato ? { data_firma: '2026-11-20T10:00:00Z' } : null,
      },
    })

    function ambienteNuovoTrasportatore(extra: Record<string, unknown> = {}) {
      // Il tenant e' il NUOVO trasportatore: il trasbordo e' stato aperto da altri (nessuna riga nostra).
      const a = ambiente({
        cfTenant: CF_NUOVO,
        trasbordo: dellEnte(CF_NUOVO),
        ...extra,
      })
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaTrasbordoTotale' }],
      })
      return a
    }

    it('il nuovo trasportatore firma dal ciclo comune (una authorize), con tipo TRASBORDO_TOTALE, e lo storico registra la firma', async () => {
      const a = ambienteNuovoTrasportatore()

      const esito = await a.useCase.firma({ firId: FIR_ID, tenantId: TENANT, utenteId: 'u1' })

      expect(esito).toEqual({ esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect(a.completa.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          firId: FIR_ID,
          tenantId: TENANT,
          tipoOperazione: tipoOperazioneTrasbordoTotale(),
        })
      )
      const firmata = (await a.eventi.elenca(TENANT, FIR_ID)).find(
        e => e.operazione === 'AcquisizioneFirmaTrasbordoTotale'
      )
      expect(firmata).toMatchObject({ esito: 'ACCETTATA' })
      // Chi firma non aggiunge tratte: il trasbordo l'ha dichiarato qualcun altro.
      expect(a.datiViaggio.scritture).toEqual([])
    })

    it('senza AcquisizioneFirmaTrasbordoTotale in /azioni: FIRMA_TRASBORDO_TOTALE_NON_DISPONIBILE, nessuna authorize', async () => {
      const a = ambienteNuovoTrasportatore()
      a.getAzioni.execute.mockResolvedValue({ azioni: [{ operazione: 'Annotazione' }] })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIRMA_TRASBORDO_TOTALE_NON_DISPONIBILE' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it.each([
      ['il trasbordo e di un altro trasportatore', dellEnte('99999999999')],
      ["l'ente non mostra nessun trasbordo", null],
      ['il trasbordo e gia firmato', dellEnte(CF_NUOVO, true)],
    ])('%s: TRASBORDO_TOTALE_FIRMA_NON_TUA, nessuna authorize', async (_n, trasbordo) => {
      const a = ambienteNuovoTrasportatore({ trasbordo })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_FIRMA_NON_TUA' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it('chi ha DICHIARATO il trasbordo (non e il nuovo trasportatore) non puo firmarlo: TRASBORDO_TOTALE_FIRMA_NON_TUA', async () => {
      const a = ambiente({ trasbordo: dellEnte(CF_NUOVO) })
      await trasbordoNostroInSospeso(a)
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaTrasbordoTotale' }],
      })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'TRASBORDO_TOTALE_FIRMA_NON_TUA' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it('CF del tenant mancante: CF_TENANT_MANCANTE; modulo spento: MODULO_NON_ATTIVO', async () => {
      const a = ambienteNuovoTrasportatore({ cfTenant: null })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'CF_TENANT_MANCANTE' }),
      })
      const b = ambienteNuovoTrasportatore({ moduli: ['fir'] })
      await expect(b.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'MODULO_NON_ATTIVO' }),
      })
    })

    it('firma rifiutata dall’ente: lo storico lo registra (RIFIUTATA) e l’errore si propaga', async () => {
      const a = ambienteNuovoTrasportatore()
      const errore = Object.assign(new Error('rifiutata'), { code: 'FIRMA_RIFIUTATA' })
      a.completa.execute.mockRejectedValue(errore)
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toBe(errore)
    })

    it('prenotazione d’invio viva: SESSIONE_FIRMA_IN_CORSO, nessuna authorize', async () => {
      const a = ambienteNuovoTrasportatore()
      await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: tipoPrenotazioneInvioTrasbordoTotale(),
        scadenza: new Date(Date.now() + 60_000),
        utenteId: 'u1',
      })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })
  })

  describe('riprendiInvio: la prenotazione non e mai una firma da riprendere', () => {
    it('prenotazione viva: SESSIONE_FIRMA_IN_CORSO; appesa: si chiude e si passa dalla firma (riconciliando prima)', async () => {
      const viva = ambiente()
      const prenViva = await viva.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: tipoPrenotazioneInvioTrasbordoTotale(),
        scadenza: new Date(Date.now() + 60_000),
        utenteId: 'u1',
      })
      await expect(
        viva.useCase.riprendiInvio({ firId: FIR_ID, tenantId: TENANT, sessioneId: prenViva.id })
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })

      const appesa = ambiente({ cfTenant: CF_NUOVO })
      const prenAppesa = await appesa.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: tipoPrenotazioneInvioTrasbordoTotale(),
        scadenza: new Date(Date.now() - 1_000),
        utenteId: 'u1',
      })
      appesa.getAzioni.execute.mockReset()
      appesa.getAzioni.execute.mockResolvedValue({ azioni: [] })
      await expect(
        appesa.useCase.riprendiInvio({
          firId: FIR_ID,
          tenantId: TENANT,
          sessioneId: prenAppesa.id,
        })
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIRMA_TRASBORDO_TOTALE_NON_DISPONIBILE' }),
      })
      expect(await appesa.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it('una sessione di altro tipo o di un altro FIR: 404', async () => {
      const a = ambiente()
      const altra = await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: 'ACCETTAZIONE',
        scadenza: new Date(Date.now() + 60_000),
        utenteId: 'u1',
      })
      await expect(
        a.useCase.riprendiInvio({ firId: FIR_ID, tenantId: TENANT, sessioneId: altra.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })
})
