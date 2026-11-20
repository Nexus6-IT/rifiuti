import { FIR, ParteFIR } from '../../domain/fir/aggregates/fir.aggregate'
import { TrasmissioneRentriIncertaError } from '../../infrastructure/rentri/rentri-api.client'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'
import {
  LUOGO_SOSTA_MAX,
  SostaTecnicaRentriUseCase,
  tipoOperazioneSostaTecnica,
  tipoPrenotazioneInvioSostaTecnica,
} from './sosta-tecnica-rentri.use-case'

/**
 * FIR in viaggio P5 — sosta tecnica: luogo 1..1000, sospensione < ripresa, date in UTC, solo un trasportatore
 * del FIR (quello che ha in carico il rifiuto), disponibilita' decisa da `/azioni`, firma del trasportatore dal
 * ciclo comune, storico per ogni esito. Stessa solidita' dell'annotazione (P4): prenotazione dell'invio,
 * riga INVIATA prima del POST, riconciliazione di un esito ignoto, firma solo di una sosta propria.
 */
describe('SostaTecnicaRentriUseCase', () => {
  const TENANT = 'tenant-p5-1'
  const FIR_ID = 'fir-p5-1'
  const NUMERO_FIR = 'BCDFGH00051ZH'
  const CF_TENANT = '01234567897'
  const SOSPENSIONE = '2026-11-18T10:00:00.000Z'
  const RIPRESA = '2026-11-18T12:30:00.000Z'
  const LUOGO = 'Area di servizio A1 km 120'
  const CORPO = {
    luogo_stazionamento: LUOGO,
    data_ora_sospensione: SOSPENSIONE,
    data_ora_ripresa: RIPRESA,
  }

  const parte = (partitaIva: string, codiceFiscale?: string): ParteFIR => ({
    ragioneSociale: 'Ditta',
    partitaIva,
    ...(codiceFiscale && { codiceFiscale }),
  })

  function creaFir(
    opzioni: {
      legato?: boolean
      produttore?: ParteFIR
      trasportatore?: ParteFIR
      destinatario?: ParteFIR
      aggiuntivi?: { partitaIva?: string; codiceFiscale?: string }[]
    } = {}
  ): FIR {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT,
      rifiuto: { cerCode: '150101', quantita: 10 },
      produttore: opzioni.produttore ?? parte('33333333335'),
      trasportatore: opzioni.trasportatore ?? parte(CF_TENANT),
      destinatario: opzioni.destinatario ?? parte('22222222226'),
      trasportatoriAggiuntivi: (opzioni.aggiuntivi ?? []).map((a, i) => ({
        ordine: i + 2,
        tipoTratta: 'TERRESTRE' as any,
        denominazione: 'Altro',
        ...a,
      })),
    })
    Object.assign(fir, { _id: FIR_ID })
    fir.emetti('FIR-P5-000001', { firmatario: 'X', timestamp: new Date(), certificato: 'c' })
    if (opzioni.legato !== false) fir.markRENTRISynced(NUMERO_FIR)
    return fir
  }

  function ambiente(
    opzioni: {
      fir?: FIR
      azioni?: string[]
      esito?: Record<string, unknown>
      cfTenant?: string | null
      moduli?: string[]
      firma?: unknown
      soste?: unknown[]
    } = {}
  ) {
    const fir = opzioni.fir ?? creaFir()
    const eventi = new EventiFirRentriInMemoria()
    const sessioni = new SessioniFirmaRentriInMemoria()
    const firRepository = { findById: jest.fn().mockResolvedValue(fir), save: jest.fn() }
    const azioniIniziali = (opzioni.azioni ?? ['SostaTecnica']).map(operazione => ({ operazione }))
    // Dopo l'invio l'ente e' in `FirmaSostaTecnica`: la seconda lettura di /azioni propone la firma.
    const getAzioni = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ azioni: azioniIniziali })
        .mockResolvedValue({
          azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }, { operazione: 'Reset' }],
        }),
    }
    const completa = {
      execute: jest
        .fn()
        .mockResolvedValue(
          opzioni.firma ?? { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' }
        ),
    }
    // Dettaglio dell'ente: di default rispecchia lo storico (l'ultima sosta ACCETTATA e' presso l'ente, firmata
    // solo dopo una chiamata al ciclo di firma).
    function sosteDaStorico() {
      const accettata = eventi.righe
        .slice()
        .reverse()
        .find(r => r.operazione === 'SostaTecnica' && r.esito === 'ACCETTATA')
      if (!accettata) return []
      const firmata = completa.execute.mock.calls.length > 0
      return [
        {
          ...(accettata.payload as Record<string, unknown>),
          dati_firma: firmata ? { data_firma: '2026-11-20T10:00:00Z' } : null,
        },
      ]
    }
    const client = {
      inviaSostaTecnica: jest
        .fn()
        .mockResolvedValue(
          opzioni.esito ?? { errore: false, validazione: [], transazioneId: 'tr-st-1' }
        ),
      leggiStato: jest
        .fn()
        .mockResolvedValue({ versione: 3, stato_formulario: 'FirmaSostaTecnica' }),
      leggiFormulario: jest.fn().mockImplementation(async () => ({
        stato_formulario: 'FirmaSostaTecnica',
        dati_soste_tecniche: opzioni.soste ?? sosteDaStorico(),
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
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const useCase = new SostaTecnicaRentriUseCase(
      firRepository as any,
      getAzioni as any,
      client as any,
      completa as any,
      eventi,
      logger,
      sessioni,
      moduli as any,
      prisma as any
    )
    return { useCase, fir, eventi, sessioni, firRepository, getAzioni, client, completa, logger }
  }

  const comando = (extra: Record<string, unknown> = {}) => ({
    firId: FIR_ID,
    tenantId: TENANT,
    luogoStazionamento: LUOGO,
    dataOraSospensione: SOSPENSIONE,
    dataOraRipresa: RIPRESA,
    utenteId: 'u1',
    ...extra,
  })

  async function nessunaRete(a: ReturnType<typeof ambiente>) {
    expect(a.getAzioni.execute).not.toHaveBeenCalled()
    expect(a.client.inviaSostaTecnica).not.toHaveBeenCalled()
    expect(a.completa.execute).not.toHaveBeenCalled()
    expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(0)
  }

  /** Una nostra sosta gia' accettata dall'ente, in attesa di firma (storico locale). */
  async function sostaNostraInSospeso(a: ReturnType<typeof ambiente>, corpo = CORPO) {
    await a.eventi.registra({
      tenantId: TENANT,
      firId: FIR_ID,
      operazione: 'SostaTecnica',
      payload: corpo,
      transazioneId: 'tr-sospesa',
      esito: 'ACCETTATA',
      dettaglioEnte: null,
      statoFormularioDopo: 'FirmaSostaTecnica',
      utenteId: 'u1',
    })
  }

  async function righeSosta(a: ReturnType<typeof ambiente>) {
    const tutte = await a.eventi.elenca(TENANT, FIR_ID)
    return tutte.filter(r => r.operazione === 'SostaTecnica').map(r => r.esito)
  }

  describe('invia: validazione e precondizioni locali (prima di qualunque rete)', () => {
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

    it.each([[''], ['   '], ['\n\t ']])('luogo vuoto %j: SOSTA_TECNICA_NON_VALIDA', async luogo => {
      const a = ambiente()
      await expect(a.useCase.invia(comando({ luogoStazionamento: luogo }))).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_NON_VALIDA' }),
      })
      await nessunaRete(a)
    })

    it('luogo oltre 1000 caratteri: non valido; esattamente 1000 passa', async () => {
      const a = ambiente()
      await expect(
        a.useCase.invia(comando({ luogoStazionamento: 'x'.repeat(LUOGO_SOSTA_MAX + 1) }))
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_NON_VALIDA' }),
      })
      await nessunaRete(a)

      const b = ambiente()
      await b.useCase.invia(comando({ luogoStazionamento: 'x'.repeat(LUOGO_SOSTA_MAX) }))
      expect(b.client.inviaSostaTecnica).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['non una data', 'ieri', RIPRESA],
      ['senza fuso orario', '2026-11-18T10:00:00', RIPRESA],
      ['solo la data', '2026-11-18', RIPRESA],
      ['giorno inesistente', '2026-02-31T10:00:00Z', RIPRESA],
      ['ripresa non valida', SOSPENSIONE, '2026-11-18T25:00:00Z'],
    ])('data non valida (%s): SOSTA_TECNICA_NON_VALIDA, nessuna rete', async (_n, sosp, ripr) => {
      const a = ambiente()
      await expect(
        a.useCase.invia(comando({ dataOraSospensione: sosp, dataOraRipresa: ripr }))
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_NON_VALIDA' }),
      })
      await nessunaRete(a)
    })

    it('la sospensione deve precedere la ripresa: uguali o invertite sono rifiutate', async () => {
      const uguali = ambiente()
      await expect(
        uguali.useCase.invia(comando({ dataOraRipresa: SOSPENSIONE }))
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_NON_VALIDA' }),
      })
      const invertite = ambiente()
      await expect(
        invertite.useCase.invia(
          comando({ dataOraSospensione: RIPRESA, dataOraRipresa: SOSPENSIONE })
        )
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_NON_VALIDA' }),
      })
      await nessunaRete(uguali)
      await nessunaRete(invertite)
    })

    it("un offset diverso da Z e' accettato e il corpo parte SEMPRE in UTC (e col luogo senza spazi ai lati)", async () => {
      const a = ambiente()
      await a.useCase.invia(
        comando({
          luogoStazionamento: `  ${LUOGO}  `,
          dataOraSospensione: '2026-11-18T11:00:00+01:00',
          dataOraRipresa: '2026-11-18T13:30:00.000+01:00',
        })
      )
      expect(a.client.inviaSostaTecnica).toHaveBeenCalledWith(TENANT, NUMERO_FIR, CORPO)
    })

    it('CF del tenant mancante: CF_TENANT_MANCANTE', async () => {
      const a = ambiente({ cfTenant: null })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'CF_TENANT_MANCANTE' }),
      })
      await nessunaRete(a)
    })

    it.each([
      [
        'solo produttore',
        { produttore: parte('x', CF_TENANT), trasportatore: parte('44444444440') },
      ],
      [
        'solo destinatario',
        { destinatario: parte('x', CF_TENANT), trasportatore: parte('44444444440') },
      ],
    ])('%s: SOSTA_TECNICA_SOGGETTO_NON_NEL_FIR, nessuna rete', async (_n, fir) => {
      const a = ambiente({ fir: creaFir(fir) })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_SOGGETTO_NON_NEL_FIR' }),
      })
      await nessunaRete(a)
    })

    it.each([
      ['partita IVA del trasportatore', { trasportatore: parte(CF_TENANT) }],
      ['codice fiscale del trasportatore', { trasportatore: parte('99', CF_TENANT) }],
      [
        'trasportatore aggiuntivo',
        { trasportatore: parte('44444444440'), aggiuntivi: [{ partitaIva: CF_TENANT }] },
      ],
    ])("il tenant e' %s: ammesso", async (_n, fir) => {
      const a = ambiente({ fir: creaFir(fir) })
      await a.useCase.invia(comando())
      expect(a.client.inviaSostaTecnica).toHaveBeenCalledTimes(1)
    })
  })

  describe('invia: /azioni, POST, storico, firma', () => {
    it('sequenza felice: INVIATA, POST con corpo del contratto, stato riletto, ACCETTATA, firma del trasportatore', async () => {
      const a = ambiente()
      const esito = await a.useCase.invia(comando())

      expect(a.client.inviaSostaTecnica).toHaveBeenCalledWith(TENANT, NUMERO_FIR, CORPO)
      expect(esito).toMatchObject({
        operazione: 'SostaTecnica',
        statoFormulario: 'FirmaSostaTecnica',
        firma: { esito: 'COMPLETATA' },
      })
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect(a.completa.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          firId: FIR_ID,
          tenantId: TENANT,
          tipoOperazione: tipoOperazioneSostaTecnica(),
        })
      )
      const storico = (await a.eventi.elenca(TENANT, FIR_ID)).slice().reverse()
      expect(storico.map(r => `${r.operazione}:${r.esito}`)).toEqual([
        'SostaTecnica:INVIATA',
        'SostaTecnica:ACCETTATA',
        'AcquisizioneFirmaSostaTecnica:ACCETTATA',
      ])
      expect(storico[1].payload).toEqual(CORPO)
      expect(storico[1].transazioneId).toBe('tr-st-1')
      // La firma e' legata alla sosta firmata (transazione e hash del contenuto).
      expect(storico[2].payload).toEqual({
        transazioneIdSosta: 'tr-st-1',
        sostaSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
      expect(a.firRepository.save).toHaveBeenCalled()
    })

    it('/azioni non propone la sosta: OPERAZIONE_NON_DISPONIBILE, nessun POST, nessuna riga', async () => {
      const a = ambiente({ azioni: ['Annotazione'] })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'OPERAZIONE_NON_DISPONIBILE' }),
      })
      expect(a.client.inviaSostaTecnica).not.toHaveBeenCalled()
      expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(0)
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it("una nostra sosta gia' in attesa di firma: SOSTA_TECNICA_DA_FIRMARE, nessun POST", async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaSostaTecnica'] })
      await sostaNostraInSospeso(a)
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_DA_FIRMARE' }),
      })
      expect(a.client.inviaSostaTecnica).not.toHaveBeenCalled()
    })

    it("una firma di sosta in attesa che non e' nostra: SOSTA_TECNICA_DI_ALTRO_SOGGETTO", async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaSostaTecnica'] })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_DI_ALTRO_SOGGETTO' }),
      })
      expect(a.client.inviaSostaTecnica).not.toHaveBeenCalled()
    })

    it("rifiuto dell'ente nell'esito: RIFIUTATA, 400 con codice, nessuna firma, prenotazione rilasciata", async () => {
      const a = ambiente({
        esito: { errore: true, validazione: [{ x: 1 }], transazioneId: 'tr-no' },
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_RENTRI_RIFIUTATA' }),
      })
      expect(await righeSosta(a)).toEqual(['RIFIUTATA', 'INVIATA'])
      expect(a.completa.execute).not.toHaveBeenCalled()
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it("rifiuto 4xx dell'ente: RIFIUTATA e SOSTA_TECNICA_RENTRI_RIFIUTATA", async () => {
      const a = ambiente()
      a.client.inviaSostaTecnica.mockRejectedValue(
        new RentriApiError(422, 'Dati non validi', 'luogo troppo lungo', false)
      )
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_RENTRI_RIFIUTATA' }),
      })
      expect(await righeSosta(a)).toEqual(['RIFIUTATA', 'INVIATA'])
    })

    it('esito incerto (5xx): INCERTA con la transazione se nota, errore originale, nessuna firma, prenotazione rilasciata', async () => {
      const a = ambiente()
      const errore = new TrasmissioneRentriIncertaError(
        'ESITO_NON_DISPONIBILE',
        undefined,
        'sosta tecnica',
        'tr-incerta'
      )
      a.client.inviaSostaTecnica.mockRejectedValue(errore)
      await expect(a.useCase.invia(comando())).rejects.toBe(errore)
      const storico = await a.eventi.elenca(TENANT, FIR_ID)
      expect(storico[0]).toMatchObject({
        operazione: 'SostaTecnica',
        esito: 'INCERTA',
        transazioneId: 'tr-incerta',
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it("la riga INVIATA e' scritta PRIMA del POST: se non si puo' scrivere il POST non parte", async () => {
      const a = ambiente()
      jest.spyOn(a.eventi, 'registra').mockRejectedValue(new Error('db giu'))
      await expect(a.useCase.invia(comando())).rejects.toThrow('db giu')
      expect(a.client.inviaSostaTecnica).not.toHaveBeenCalled()
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it("due invii concorrenti: un solo POST, l'altro 409 SESSIONE_FIRMA_IN_CORSO", async () => {
      const a = ambiente()
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 20))
        return { azioni: [{ operazione: 'SostaTecnica' }] }
      })
      const esiti = await Promise.allSettled([
        a.useCase.invia(comando()),
        a.useCase.invia(comando()),
      ])
      expect(a.client.inviaSostaTecnica).toHaveBeenCalledTimes(1)
      const rifiutati = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
      expect(rifiutati).toHaveLength(1)
      expect(rifiutati[0].reason).toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
    })

    it('una prenotazione scaduta (processo morto) non blocca per sempre', async () => {
      const a = ambiente()
      await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: tipoPrenotazioneInvioSostaTecnica(),
        scadenza: new Date(Date.now() - 1000),
      })
      await a.useCase.invia(comando())
      expect(a.client.inviaSostaTecnica).toHaveBeenCalledTimes(1)
    })

    it('la firma che solleva non annulla la sosta: DA_COMPLETARE con avviso', async () => {
      const a = ambiente()
      a.completa.execute.mockRejectedValue(new Error('telefono non raggiungibile'))
      const esito = await a.useCase.invia(comando())
      expect(esito.firma).toMatchObject({ esito: 'DA_COMPLETARE' })
      expect(await righeSosta(a)).toEqual(['ACCETTATA', 'INVIATA'])
    })

    it("firma IN_ATTESA: la sessione resta del ciclo comune e l'esito e' passato cosi' com'e'", async () => {
      const a = ambiente({ firma: { esito: 'IN_ATTESA', sessioneId: 's1' } })
      const esito = await a.useCase.invia(comando())
      expect(esito.firma).toMatchObject({ esito: 'IN_ATTESA' })
    })
  })

  describe('firma', () => {
    it('senza AcquisizioneFirmaSostaTecnica in /azioni: FIRMA_SOSTA_TECNICA_NON_DISPONIBILE, nessuna authorize', async () => {
      const a = ambiente()
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({ azioni: [{ operazione: 'SostaTecnica' }] })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIRMA_SOSTA_TECNICA_NON_DISPONIBILE' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it('sosta non nostra (nessuna nello storico): SOSTA_TECNICA_DI_ALTRO_SOGGETTO, nessuna authorize', async () => {
      const a = ambiente()
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }],
      })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_DI_ALTRO_SOGGETTO' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it("l'ente mostra una sosta diversa da quella nostra: DI_ALTRO_SOGGETTO, nessuna authorize", async () => {
      const a = ambiente({
        soste: [{ ...CORPO, luogo_stazionamento: 'Altro posto', dati_firma: null }],
      })
      await sostaNostraInSospeso(a)
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }],
      })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_DI_ALTRO_SOGGETTO' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it("sosta nostra e confermata dall'ente: una sola authorize dal ciclo comune, evento col legame", async () => {
      const a = ambiente({ soste: [{ ...CORPO, dati_firma: null }] })
      await sostaNostraInSospeso(a)
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }],
      })
      const esito = await a.useCase.firma({ firId: FIR_ID, tenantId: TENANT, utenteId: 'u1' })
      expect(esito.esito).toBe('COMPLETATA')
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect(a.completa.execute).toHaveBeenCalledWith(
        expect.objectContaining({ tipoOperazione: 'SOSTA_TECNICA' })
      )
    })

    it('un Reset accettato dopo la sosta la toglie dallo storico «in sospeso»', async () => {
      const a = ambiente({ soste: [{ ...CORPO, dati_firma: null }] })
      await sostaNostraInSospeso(a)
      await a.eventi.registra({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'Reset',
        payload: null,
        transazioneId: null,
        esito: 'ACCETTATA',
        dettaglioEnte: null,
        statoFormularioDopo: 'InserimentoAccettazione',
        utenteId: 'u1',
      })
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }],
      })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_DI_ALTRO_SOGGETTO' }),
      })
    })

    it("una prenotazione d'invio viva: SESSIONE_FIRMA_IN_CORSO prima di riconciliare o firmare", async () => {
      const a = ambiente()
      await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: tipoPrenotazioneInvioSostaTecnica(),
        scadenza: new Date(Date.now() + 60000),
      })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it("firma completata ma senza dati_firma presso l'ente: la firma resta valida, la riga lo segnala", async () => {
      const a = ambiente({ soste: [{ ...CORPO, dati_firma: null }] })
      await sostaNostraInSospeso(a)
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }],
      })
      await a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })
      const ultima = (await a.eventi.elenca(TENANT, FIR_ID))[0]
      expect(ultima.operazione).toBe('AcquisizioneFirmaSostaTecnica')
      expect(ultima.dettaglioEnte).toContain('dati_firma')
      expect(a.logger.warn).toHaveBeenCalled()
    })
  })

  describe('riconciliazione di un invio senza esito', () => {
    async function invioSenzaEsito(
      a: ReturnType<typeof ambiente>,
      esito: 'INVIATA' | 'INCERTA',
      eta = 3600_000,
      transazioneId: string | null = null
    ) {
      await a.eventi.registra({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'SostaTecnica',
        payload: CORPO,
        transazioneId,
        esito,
        dettaglioEnte: null,
        statoFormularioDopo: null,
        utenteId: 'u1',
      })
      const riga = a.eventi.righe[a.eventi.righe.length - 1]
      riga.createdAt = new Date(Date.now() - eta)
    }

    it("INCERTA e la sosta e' presso l'ente non firmata: adottata (ACCETTATA riconciliata) e firmata con una sola authorize", async () => {
      const a = ambiente({ soste: [{ ...CORPO, dati_firma: null }] })
      await invioSenzaEsito(a, 'INCERTA')
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }],
      })
      const esito = await a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })
      expect(esito.esito).toBe('COMPLETATA')
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect(await righeSosta(a)).toContain('ACCETTATA')
    })

    it("le date dell'ente in un altro formato ma lo stesso istante combaciano", async () => {
      const a = ambiente({
        soste: [
          {
            luogo_stazionamento: LUOGO,
            data_ora_sospensione: '2026-11-18T10:00:00Z',
            data_ora_ripresa: '2026-11-18T12:30:00+00:00',
            dati_firma: null,
          },
        ],
      })
      await invioSenzaEsito(a, 'INCERTA')
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }],
      })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).resolves.toMatchObject({
        esito: 'COMPLETATA',
      })
    })

    it("INCERTA recente e non presso l'ente: SOSTA_TECNICA_IN_VERIFICA, nessun POST, nessuna riga nuova", async () => {
      const a = ambiente({ soste: [] })
      await invioSenzaEsito(a, 'INCERTA', 1000)
      const prima = a.eventi.righe.length
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_IN_VERIFICA' }),
      })
      expect(a.client.inviaSostaTecnica).not.toHaveBeenCalled()
      expect(a.eventi.righe).toHaveLength(prima)
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it("INVIATA vecchia (processo morto) e non presso l'ente: RIFIUTATA riconciliata e si reinvia", async () => {
      const a = ambiente({ soste: [] })
      await invioSenzaEsito(a, 'INVIATA')
      await a.useCase.invia(comando())
      expect(a.client.inviaSostaTecnica).toHaveBeenCalledTimes(1)
      const righe = await righeSosta(a)
      expect(righe).toContain('RIFIUTATA')
    })

    it("transazione ancora in elaborazione presso l'ente: IN_VERIFICA anche fuori dalla finestra", async () => {
      const a = ambiente({ soste: [] })
      await invioSenzaEsito(a, 'INCERTA', 3600_000, 'tr-lenta')
      a.client.leggiStatoTransazione.mockResolvedValue({ stato: 'IN_ELABORAZIONE' })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_IN_VERIFICA' }),
      })
      expect(a.client.inviaSostaTecnica).not.toHaveBeenCalled()
    })

    it('transazione nota e non trovata: decisione subito dal dettaglio, anche dentro la finestra', async () => {
      const a = ambiente({ soste: [] })
      await invioSenzaEsito(a, 'INCERTA', 1000, 'tr-sparita')
      a.client.leggiStatoTransazione.mockResolvedValue({ stato: 'NON_TROVATA' })
      await a.useCase.invia(comando())
      expect(a.client.inviaSostaTecnica).toHaveBeenCalledTimes(1)
    })

    it("dettaglio non leggibile: l'errore si propaga, nessuna decisione e nessun POST", async () => {
      const a = ambiente()
      await invioSenzaEsito(a, 'INCERTA')
      a.client.leggiFormulario.mockRejectedValue(new Error('ente giu'))
      await expect(a.useCase.invia(comando())).rejects.toThrow('ente giu')
      expect(a.client.inviaSostaTecnica).not.toHaveBeenCalled()
    })

    it("due soste non firmate presso l'ente: non si sa quale sia la nostra, non si adotta nulla", async () => {
      const a = ambiente({
        soste: [
          { ...CORPO, dati_firma: null },
          { ...CORPO, luogo_stazionamento: 'altra', dati_firma: null },
        ],
      })
      await invioSenzaEsito(a, 'INCERTA', 1000)
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SOSTA_TECNICA_IN_VERIFICA' }),
      })
    })
  })

  describe('riprendiInvio', () => {
    it('prenotazione viva: 409 SESSIONE_FIRMA_IN_CORSO', async () => {
      const a = ambiente()
      const p = await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: tipoPrenotazioneInvioSostaTecnica(),
        scadenza: new Date(Date.now() + 60000),
      })
      await expect(
        a.useCase.riprendiInvio({ firId: FIR_ID, tenantId: TENANT, sessioneId: p.id })
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
    })

    it('prenotazione appesa: si chiude e si passa da firma (riconciliazione, /azioni, controllo «propria»)', async () => {
      const a = ambiente({ soste: [{ ...CORPO, dati_firma: null }] })
      await sostaNostraInSospeso(a)
      const p = await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: tipoPrenotazioneInvioSostaTecnica(),
        scadenza: new Date(Date.now() - 1000),
      })
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute.mockResolvedValue({
        azioni: [{ operazione: 'AcquisizioneFirmaSostaTecnica' }],
      })
      const esito = await a.useCase.riprendiInvio({
        firId: FIR_ID,
        tenantId: TENANT,
        sessioneId: p.id,
      })
      expect(esito.esito).toBe('COMPLETATA')
      expect((await a.sessioni.trovaPerId(TENANT, p.id))?.stato).toBe('ANNULLATA')
    })

    it("una sessione che non e' una prenotazione di sosta: non trovata", async () => {
      const a = ambiente()
      await expect(
        a.useCase.riprendiInvio({ firId: FIR_ID, tenantId: TENANT, sessioneId: 'inesistente' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })
})
