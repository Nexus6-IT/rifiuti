import { FIR, ParteFIR } from '../../domain/fir/aggregates/fir.aggregate'
import { createHash } from 'crypto'
import { TrasmissioneRentriIncertaError } from '../../infrastructure/rentri/rentri-api.client'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'
import {
  AnnotazioneRentriUseCase,
  TESTO_ANNOTAZIONE_MAX,
  tipoOperazioneAnnotazione,
} from './annotazione-rentri.use-case'

/**
 * FIR in viaggio P4, T0-T1 — annotazione: `identificativo_soggetto` = CF del tenant (che deve comparire nel
 * FIR), testo 1..10.000, disponibilita' decisa da `/azioni`, firma dal ciclo comune, storico per ogni esito.
 */
describe('AnnotazioneRentriUseCase', () => {
  const TENANT = 'tenant-p4-1'
  const FIR_ID = 'fir-p4-1'
  const NUMERO_FIR = 'BCDFGH00041ZH'
  const CF_TENANT = '01234567897'

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
    fir.emetti('FIR-P4-000001', { firmatario: 'X', timestamp: new Date(), certificato: 'c' })
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
      annotazioniEnte?: unknown[]
    } = {}
  ) {
    const fir = opzioni.fir ?? creaFir()
    const eventi = new EventiFirRentriInMemoria()
    const sessioni = new SessioniFirmaRentriInMemoria()
    const firRepository = { findById: jest.fn().mockResolvedValue(fir), save: jest.fn() }
    const azioniIniziali = (opzioni.azioni ?? ['Annotazione']).map(operazione => ({ operazione }))
    // Dopo l'invio l'ente e' in `FirmaAnnotazione`: la seconda lettura di /azioni propone la firma.
    const getAzioni = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ azioni: azioniIniziali })
        .mockResolvedValue({
          azioni: [{ operazione: 'AcquisizioneFirmaAnnotazione' }, { operazione: 'Reset' }],
        }),
    }
    const client = {
      inviaAnnotazione: jest
        .fn()
        .mockResolvedValue(
          opzioni.esito ?? { errore: false, validazione: [], transazioneId: 'tr-an-1' }
        ),
      leggiStato: jest
        .fn()
        .mockResolvedValue({ versione: 3, stato_formulario: 'FirmaAnnotazione' }),
      // Dettaglio del formulario: le annotazioni dell'ente. Di default rispecchia lo storico: l'ultima
      // annotazione nostra ACCETTATA e' presso l'ente, firmata solo dopo una chiamata al ciclo di firma.
      leggiFormulario: jest.fn().mockImplementation(async () => ({
        stato_formulario: 'FirmaAnnotazione',
        dati_annotazioni: opzioni.annotazioniEnte ?? annotazioniDaStorico(),
      })),
      leggiStatoTransazione: jest.fn().mockResolvedValue({ stato: 'NON_TROVATA' }),
    }
    function annotazioniDaStorico() {
      const accettata = eventi.righe
        .slice()
        .reverse()
        .find(r => r.operazione === 'Annotazione' && r.esito === 'ACCETTATA')
      if (!accettata) return []
      const firmata = completa.execute.mock.calls.length > 0
      return [
        {
          ...(accettata.payload as Record<string, unknown>),
          dati_firma: firmata ? { data_firma: '2026-11-20T10:00:00Z' } : null,
        },
      ]
    }
    const completa = {
      execute: jest
        .fn()
        .mockResolvedValue(
          opzioni.firma ?? { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' }
        ),
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
    const useCase = new AnnotazioneRentriUseCase(
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
    return {
      logger,
      useCase,
      fir,
      eventi,
      sessioni,
      firRepository,
      getAzioni,
      client,
      completa,
      prisma,
      moduli,
    }
  }

  const comando = (extra: Record<string, unknown> = {}) => ({
    firId: FIR_ID,
    tenantId: TENANT,
    testo: 'Il carico e stato pesato due volte',
    utenteId: 'u1',
    ...extra,
  })

  async function nessunaRete(a: ReturnType<typeof ambiente>) {
    expect(a.getAzioni.execute).not.toHaveBeenCalled()
    expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
    expect(a.completa.execute).not.toHaveBeenCalled()
    expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(0)
  }

  /** Una nostra annotazione gia accettata dall'ente, in attesa di firma (storico locale). */
  async function annotazioneNostraInSospeso(
    a: ReturnType<typeof ambiente>,
    testo = 'Annotazione in sospeso',
    cf = CF_TENANT
  ) {
    await a.eventi.registra({
      tenantId: TENANT,
      firId: FIR_ID,
      operazione: 'Annotazione',
      payload: { annotazione: testo, identificativo_soggetto: cf },
      transazioneId: 'tr-sospesa',
      esito: 'ACCETTATA',
      dettaglioEnte: null,
      statoFormularioDopo: 'FirmaAnnotazione',
      utenteId: 'u1',
    })
  }

  describe('invia: precondizioni locali (prima di qualunque rete)', () => {
    it('FIR inesistente: 404', async () => {
      const a = ambiente()
      a.firRepository.findById.mockResolvedValue(null)
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await nessunaRete(a)
    })

    it('FIR di un altro tenant: non autorizzato', async () => {
      const a = ambiente()
      await expect(a.useCase.invia(comando({ tenantId: 'altro' }))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
      await nessunaRete(a)
    })

    it('FIR non legato: FIR_NON_LEGATO_RENTRI', async () => {
      const a = ambiente({ fir: creaFir({ legato: false }) })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIR_NON_LEGATO_RENTRI' }),
      })
      await nessunaRete(a)
    })

    it('modulo rentri non attivo: MODULO_NON_ATTIVO', async () => {
      const a = ambiente({ moduli: ['fir'] })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'MODULO_NON_ATTIVO' }),
      })
      await nessunaRete(a)
    })

    it.each([[''], ['   '], ['\n\t ']])('testo vuoto %j: ANNOTAZIONE_NON_VALIDA', async testo => {
      const a = ambiente()
      await expect(a.useCase.invia(comando({ testo }))).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_NON_VALIDA' }),
      })
      await nessunaRete(a)
    })

    it('testo oltre 10.000 caratteri: ANNOTAZIONE_NON_VALIDA; esattamente 10.000 passa', async () => {
      const a = ambiente()
      await expect(
        a.useCase.invia(comando({ testo: 'x'.repeat(TESTO_ANNOTAZIONE_MAX + 1) }))
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_NON_VALIDA' }),
      })
      await nessunaRete(a)

      const b = ambiente()
      await b.useCase.invia(comando({ testo: 'x'.repeat(TESTO_ANNOTAZIONE_MAX) }))
      expect(b.client.inviaAnnotazione).toHaveBeenCalledTimes(1)
    })

    it('CF del tenant mancante: CF_TENANT_MANCANTE', async () => {
      const a = ambiente({ cfTenant: null })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'CF_TENANT_MANCANTE' }),
      })
      await nessunaRete(a)
    })

    it('CF del tenant che non compare nel FIR: 409 chiaro, nessuna rete', async () => {
      const a = ambiente({
        fir: creaFir({ produttore: parte('33333333335'), trasportatore: parte('11111111119') }),
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({
          rule: 'ANNOTAZIONE_SOGGETTO_NON_NEL_FIR',
          details: expect.stringContaining('non compare'),
        }),
      })
      await nessunaRete(a)
    })

    it.each([
      [
        'trasportatore (P.IVA con prefisso IT)',
        { produttore: parte('33333333335'), trasportatore: parte('IT' + CF_TENANT) },
      ],
      [
        'trasportatore (codice fiscale)',
        { produttore: parte('33333333335'), trasportatore: parte('', CF_TENANT.toLowerCase()) },
      ],
      ['trasportatore', { produttore: parte('33333333335'), trasportatore: parte(CF_TENANT) }],
      [
        'produttore che e anche destinatario',
        { produttore: parte(CF_TENANT), destinatario: parte(CF_TENANT) },
      ],
      ['destinatario', { produttore: parte('33333333335'), destinatario: parte(CF_TENANT) }],
      [
        'trasportatore aggiuntivo',
        { produttore: parte('33333333335'), aggiuntivi: [{ codiceFiscale: CF_TENANT }] },
      ],
    ])('il CF compare come %s: ammesso', async (_nome, parti) => {
      const a = ambiente({ fir: creaFir(parti as any) })
      await a.useCase.invia(comando())
      expect(a.client.inviaAnnotazione).toHaveBeenCalledTimes(1)
    })

    it('il solo produttore NON e ammesso (contratto: trasportatore o destinatario): 409, nessuna rete', async () => {
      const a = ambiente({
        fir: creaFir({
          produttore: parte(CF_TENANT),
          trasportatore: parte('11111111119'),
          destinatario: parte('22222222226'),
        }),
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_SOGGETTO_NON_NEL_FIR' }),
      })
      await nessunaRete(a)
    })

    it('firma in attesa sul FIR: SESSIONE_FIRMA_IN_CORSO, nessuna chiamata all ente', async () => {
      const a = ambiente()
      await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: 'ACCETTAZIONE',
        scadenza: new Date(Date.now() + 60000),
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
      expect(a.getAzioni.execute).not.toHaveBeenCalled()
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
    })
  })

  describe('invia: disponibilita (/azioni)', () => {
    it('Annotazione non proposta: 409 OPERAZIONE_NON_DISPONIBILE, nessun POST e nessun evento', async () => {
      const a = ambiente({ azioni: ['Reset'] })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'OPERAZIONE_NON_DISPONIBILE' }),
      })
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
      expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(0)
    })

    it('annotazione NOSTRA gia in attesa di firma: ANNOTAZIONE_DA_FIRMARE (nessuna doppia annotazione)', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione', 'Reset'] })
      await annotazioneNostraInSospeso(a)
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DA_FIRMARE' }),
      })
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
    })

    it('annotazione di un ALTRO soggetto in attesa di firma: ANNOTAZIONE_DI_ALTRO_SOGGETTO, non si invita a firmarla', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione', 'Reset'] })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DI_ALTRO_SOGGETTO' }),
      })
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
    })
  })

  describe('invia: prenotazione locale (I1) e idempotenza (I2)', () => {
    it('due invii concorrenti: UN solo POST, l altro 409 SESSIONE_FIRMA_IN_CORSO', async () => {
      const a = ambiente()
      // /azioni lento: senza prenotazione entrambe le richieste lo supererebbero prima del POST.
      a.getAzioni.execute.mockImplementationOnce(async () => {
        await new Promise(r => setTimeout(r, 30))
        return { azioni: [{ operazione: 'Annotazione' }] }
      })
      a.getAzioni.execute.mockImplementationOnce(async () => {
        await new Promise(r => setTimeout(r, 30))
        return { azioni: [{ operazione: 'Annotazione' }] }
      })

      const esiti = await Promise.allSettled([
        a.useCase.invia(comando()),
        a.useCase.invia(comando({ utenteId: 'u2' })),
      ])

      expect(a.client.inviaAnnotazione).toHaveBeenCalledTimes(1)
      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      const rifiutata = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutata.reason).toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
    })

    it('la prenotazione nasce PRIMA di /azioni e di POST, e viene rilasciata prima della firma', async () => {
      const a = ambiente()
      let apertaDuranteAzioni = false
      a.getAzioni.execute.mockReset()
      a.getAzioni.execute
        .mockImplementationOnce(async () => {
          apertaDuranteAzioni = (await a.sessioni.trovaAperta(TENANT, FIR_ID)) !== null
          return { azioni: [{ operazione: 'Annotazione' }] }
        })
        .mockResolvedValue({ azioni: [{ operazione: 'AcquisizioneFirmaAnnotazione' }] })
      let apertaAllaFirma = true
      a.completa.execute.mockImplementationOnce(async () => {
        apertaAllaFirma = (await a.sessioni.trovaAperta(TENANT, FIR_ID)) !== null
        return { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' }
      })

      await a.useCase.invia(comando())

      expect(apertaDuranteAzioni).toBe(true)
      expect(apertaAllaFirma).toBe(false)
    })

    it.each([
      ['/azioni non la propone', 'azioni'],
      ['rifiuto dell ente', 'rifiuto'],
      ['errore di rete', 'rete'],
    ])('%s: la prenotazione non resta aperta a bloccare il FIR', async (_n, caso) => {
      const a = ambiente({ azioni: caso === 'azioni' ? ['Reset'] : undefined })
      if (caso === 'rifiuto')
        a.client.inviaAnnotazione.mockResolvedValue({ errore: true, validazione: [] })
      if (caso === 'rete') a.client.inviaAnnotazione.mockRejectedValue(new Error('ECONNRESET'))

      await a.useCase.invia(comando()).catch(() => undefined)

      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it('esito incerto dal client (5xx): evento INCERTA, 409 ANNOTAZIONE_ESITO_INCERTO (non un 500), nessuna firma, prenotazione rilasciata', async () => {
      const a = ambiente()
      const incerto = new TrasmissioneRentriIncertaError('HTTP_5XX', 503, 'annotazione')
      a.client.inviaAnnotazione.mockRejectedValue(incerto)

      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_ESITO_INCERTO' }),
      })

      expect((await a.eventi.elenca(TENANT, FIR_ID))[0]).toMatchObject({
        operazione: 'Annotazione',
        esito: 'INCERTA',
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it('una prenotazione IN_AVVIO scaduta (processo morto) non blocca per sempre: si chiude e si riparte', async () => {
      const a = ambiente()
      await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: 'ANNOTAZIONE_INVIO',
        scadenza: new Date(Date.now() - 1000),
      })
      await a.useCase.invia(comando())
      expect(a.client.inviaAnnotazione).toHaveBeenCalledTimes(1)
    })
  })

  describe('invia: scrittura e firma', () => {
    it('invia testo e CF del tenant, firma dal ciclo comune, storico di invio e firma', async () => {
      const a = ambiente()

      const esito = await a.useCase.invia(comando({ correlationId: 'c-1' }))

      expect(a.client.inviaAnnotazione).toHaveBeenCalledWith(TENANT, NUMERO_FIR, {
        annotazione: 'Il carico e stato pesato due volte',
        identificativo_soggetto: CF_TENANT,
      })
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect(a.completa.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          firId: FIR_ID,
          tenantId: TENANT,
          tipoOperazione: tipoOperazioneAnnotazione(),
          utenteId: 'u1',
          correlationId: 'c-1',
        })
      )
      expect(esito).toEqual({
        operazione: 'Annotazione',
        statoFormulario: 'FirmaAnnotazione',
        firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
      })
      const storico = (await a.eventi.elenca(TENANT, FIR_ID)).reverse()
      expect(storico.map(e => [e.operazione, e.esito])).toEqual([
        ['Annotazione', 'INVIATA'],
        ['Annotazione', 'ACCETTATA'],
        ['AcquisizioneFirmaAnnotazione', 'ACCETTATA'],
      ])
      for (const riga of storico.slice(0, 2)) {
        expect(riga.payload).toEqual({
          annotazione: 'Il carico e stato pesato due volte',
          identificativo_soggetto: CF_TENANT,
        })
      }
      expect(storico[1].transazioneId).toBe('tr-an-1')
    })

    it('rifiuto dell ente (esito.errore): ANNOTAZIONE_RENTRI_RIFIUTATA, evento RIFIUTATA, nessuna firma', async () => {
      const a = ambiente({
        esito: { errore: true, validazione: [{ campo: 'annotazione' }], transazioneId: 'tr-x' },
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_RENTRI_RIFIUTATA' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
      const storico = (await a.eventi.elenca(TENANT, FIR_ID)).reverse()
      expect(storico.map(e => [e.operazione, e.esito])).toEqual([
        ['Annotazione', 'INVIATA'],
        ['Annotazione', 'RIFIUTATA'],
      ])
    })

    it('4xx definitivo: RIFIUTATA; errore di rete: INCERTA e ANNOTAZIONE_ESITO_INCERTO', async () => {
      const a = ambiente()
      a.client.inviaAnnotazione.mockRejectedValue(
        new RentriApiError(422, 'Dati non validi', 'troppo lungo', false)
      )
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_RENTRI_RIFIUTATA' }),
      })
      expect((await a.eventi.elenca(TENANT, FIR_ID))[0].esito).toBe('RIFIUTATA')

      const b = ambiente()
      const rete = new Error('ECONNRESET')
      b.client.inviaAnnotazione.mockRejectedValue(rete)
      await expect(b.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_ESITO_INCERTO' }),
      })
      expect((await b.eventi.elenca(TENANT, FIR_ID))[0].esito).toBe('INCERTA')
      expect(b.completa.execute).not.toHaveBeenCalled()
      // Errore non RENTRI: lo stack resta nei log (senza dati personali), l'utente vede comunque «da verificare».
      expect(b.logger.error).toHaveBeenCalledWith(
        expect.any(String),
        rete,
        expect.not.objectContaining({ testo: expect.anything() })
      )
    })

    it('firma che solleva dopo l annotazione accettata: DA_COMPLETARE con avviso, annotazione non persa', async () => {
      const a = ambiente()
      a.completa.execute.mockRejectedValue(new Error('rete giu'))

      const esito = await a.useCase.invia(comando())

      expect(esito.operazione).toBe('Annotazione')
      expect(esito.firma).toMatchObject({
        esito: 'DA_COMPLETARE',
        avviso: expect.stringContaining('Firma RENTRI da completare'),
      })
      const storico = (await a.eventi.elenca(TENANT, FIR_ID)).reverse()
      expect(storico.map(e => [e.operazione, e.esito])).toEqual([
        ['Annotazione', 'INVIATA'],
        ['Annotazione', 'ACCETTATA'],
        ['AcquisizioneFirmaAnnotazione', 'INCERTA'],
      ])
    })

    it('firma in attesa sul telefono: esito IN_ATTESA e riga INVIATA', async () => {
      const scadenza = new Date()
      const a = ambiente({
        firma: {
          esito: 'IN_ATTESA',
          handle: 'h',
          sessioneId: 's1',
          scadenzaAutorizzazione: scadenza,
        },
      })
      const esito = await a.useCase.invia(comando())
      expect(esito.firma).toMatchObject({ esito: 'IN_ATTESA', sessioneId: 's1' })
      expect((await a.eventi.elenca(TENANT, FIR_ID))[0]).toMatchObject({
        operazione: 'AcquisizioneFirmaAnnotazione',
        esito: 'INVIATA',
      })
    })

    it('stato non rileggibile: l annotazione resta riuscita (statoFormulario null)', async () => {
      const a = ambiente()
      a.client.leggiStato.mockRejectedValue(new Error('timeout'))
      const esito = await a.useCase.invia(comando())
      expect(esito.statoFormulario).toBeNull()
      expect((await a.eventi.elenca(TENANT, FIR_ID)).some(e => e.esito === 'ACCETTATA')).toBe(true)
    })
  })

  describe('firma (ripresa o riprova)', () => {
    it('AcquisizioneFirmaAnnotazione non proposta: 409 FIRMA_ANNOTAZIONE_NON_DISPONIBILE, nessuna firma', async () => {
      const a = ambiente({ azioni: ['Annotazione'] })
      await expect(
        a.useCase.firma({ firId: FIR_ID, tenantId: TENANT, utenteId: 'u1' })
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIRMA_ANNOTAZIONE_NON_DISPONIBILE' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
      expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(0)
    })

    it('firma proposta: una sola richiesta al ciclo comune, ACCETTATA nello storico', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
      await annotazioneNostraInSospeso(a)
      const esito = await a.useCase.firma({
        firId: FIR_ID,
        tenantId: TENANT,
        utenteId: 'u1',
        nuovaSessione: true,
      })
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect(a.completa.execute).toHaveBeenCalledWith(
        expect.objectContaining({ tipoOperazione: 'ANNOTAZIONE', nuovaSessione: true })
      )
      expect(esito).toEqual({ esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
      const riga = (await a.eventi.elenca(TENANT, FIR_ID))[0]
      expect(riga).toMatchObject({ operazione: 'AcquisizioneFirmaAnnotazione', esito: 'ACCETTATA' })
      // M1: la firma e' legata al testo che si firma (transazione dell'annotazione e hash del testo).
      expect(riga.payload).toEqual({
        transazioneIdAnnotazione: 'tr-sospesa',
        testoSha256: createHash('sha256').update('Annotazione in sospeso', 'utf8').digest('hex'),
      })
    })

    it('annotazione inserita da un ALTRO soggetto: 409 ANNOTAZIONE_DI_ALTRO_SOGGETTO, nessuna authorize', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
      await annotazioneNostraInSospeso(a, 'Testo del trasportatore', '99999999990')

      await expect(
        a.useCase.firma({ firId: FIR_ID, tenantId: TENANT, utenteId: 'u1' })
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DI_ALTRO_SOGGETTO' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it('senza nessuna nostra annotazione nello storico: 409, non si firma un testo sconosciuto', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
      await expect(
        a.useCase.firma({ firId: FIR_ID, tenantId: TENANT, utenteId: 'u1' })
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DI_ALTRO_SOGGETTO' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it('un annotazione gia firmata (firma ACCETTATA piu recente) non e piu in sospeso', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
      await annotazioneNostraInSospeso(a)
      await a.eventi.registra({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'AcquisizioneFirmaAnnotazione',
        payload: null,
        transazioneId: null,
        esito: 'ACCETTATA',
        dettaglioEnte: null,
        statoFormularioDopo: 'Accettato',
        utenteId: 'u1',
      })
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DI_ALTRO_SOGGETTO' }),
      })
    })

    it('firma rifiutata dall ente (eccezione FIRMA_RENTRI_RIFIUTATA): RIFIUTATA nello storico, eccezione propagata', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
      await annotazioneNostraInSospeso(a)
      const { DomainException } = await import('../../domain/shared/domain-exception')
      a.completa.execute.mockRejectedValue(
        DomainException.businessRuleViolation('FIRMA_RENTRI_RIFIUTATA', 'no')
      )
      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIRMA_RENTRI_RIFIUTATA' }),
      })
      expect((await a.eventi.elenca(TENANT, FIR_ID))[0].esito).toBe('RIFIUTATA')
    })
  })

  describe('ciclo di vita di un invio senza esito (R1: INCERTA riconciliata con l ente)', () => {
    const TESTO_INCERTO = 'Testo inviato, risposta persa'
    const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
    const VECCHIO = new Date(Date.now() - 24 * 3600_000)

    /** Un nostro invio di cui non si conosce l'esito (esito INCERTA o solo INVIATA: processo morto). */
    async function invioSenzaEsito(
      a: ReturnType<typeof ambiente>,
      opzioni: { esito?: 'INCERTA' | 'INVIATA'; creato?: Date; testo?: string } = {}
    ) {
      const riga = await a.eventi.registra({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'Annotazione',
        payload: {
          annotazione: opzioni.testo ?? TESTO_INCERTO,
          identificativo_soggetto: CF_TENANT,
        },
        transazioneId: null,
        esito: opzioni.esito ?? 'INCERTA',
        dettaglioEnte: 'timeout',
        statoFormularioDopo: null,
        utenteId: 'u1',
      })
      riga.createdAt = opzioni.creato ?? VECCHIO
      return riga
    }

    const nostraNonFirmata = (testo = TESTO_INCERTO) => ({
      annotazione: testo,
      identificativo_soggetto: CF_TENANT,
      dati_firma: null,
    })

    it('INCERTA -> propria: l annotazione trovata presso l ente (stesso soggetto, stesso testo, non firmata) diventa ACCETTATA e si firma una volta', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione'],
        annotazioniEnte: [nostraNonFirmata()],
      })
      await invioSenzaEsito(a, { creato: new Date() }) // anche se recente: e' gia' presso l'ente

      const esito = await a.useCase.firma({ firId: FIR_ID, tenantId: TENANT, utenteId: 'u1' })

      expect(esito.esito).toBe('COMPLETATA')
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
      const storico = (await a.eventi.elenca(TENANT, FIR_ID)).reverse()
      expect(storico.map(e => [e.operazione, e.esito])).toEqual([
        ['Annotazione', 'INCERTA'],
        ['Annotazione', 'ACCETTATA'],
        ['AcquisizioneFirmaAnnotazione', 'ACCETTATA'],
      ])
      expect(storico[1].dettaglioEnte).toContain('riconciliata')
      expect(storico[2].payload).toEqual({
        transazioneIdAnnotazione: null,
        testoSha256: sha(TESTO_INCERTO),
      })
    })

    it('INCERTA -> propria in invia: 409 ANNOTAZIONE_DA_FIRMARE (non «di un altro soggetto») e nessun secondo POST', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione', 'Reset'],
        annotazioniEnte: [nostraNonFirmata()],
      })
      await invioSenzaEsito(a)

      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DA_FIRMARE' }),
      })
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it('INCERTA -> assente (fuori dalla finestra): si chiude come RIFIUTATA riconciliata e si puo reinviare', async () => {
      const a = ambiente({ annotazioniEnte: [] })
      await invioSenzaEsito(a)

      await a.useCase.invia(comando())

      expect(a.client.inviaAnnotazione).toHaveBeenCalledTimes(1)
      const storico = (await a.eventi.elenca(TENANT, FIR_ID)).reverse()
      expect(storico.map(e => [e.operazione, e.esito]).slice(0, 4)).toEqual([
        ['Annotazione', 'INCERTA'],
        ['Annotazione', 'RIFIUTATA'],
        ['Annotazione', 'INVIATA'],
        ['Annotazione', 'ACCETTATA'],
      ])
      expect(storico[1].dettaglioEnte).toContain('non risulta')
      expect(storico[1].payload).toEqual(storico[0].payload)
    })

    it('INCERTA recente e non (ancora) presso l ente: 409 ANNOTAZIONE_IN_VERIFICA, nessun POST, nessuna riga, prenotazione rilasciata', async () => {
      const a = ambiente({ annotazioniEnte: [] })
      await invioSenzaEsito(a, { creato: new Date() })

      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_IN_VERIFICA' }),
      })
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
      expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(1)
      expect(await a.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })

    it.each([
      ['testo diverso', { ...nostraNonFirmata('Un altro testo') }],
      ['altro soggetto', { ...nostraNonFirmata(), identificativo_soggetto: '99999999990' }],
      [
        'gia firmata',
        { ...nostraNonFirmata(), dati_firma: { data_firma: '2026-11-20T10:00:00Z' } },
      ],
    ])(
      'presso l ente c e un annotazione ma non la nostra (%s): non si adotta e non si firma',
      async (_n, presso) => {
        const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'], annotazioniEnte: [presso] })
        await invioSenzaEsito(a)

        await expect(
          a.useCase.firma({ firId: FIR_ID, tenantId: TENANT, utenteId: 'u1' })
        ).rejects.toMatchObject({
          metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DI_ALTRO_SOGGETTO' }),
        })
        expect(a.completa.execute).not.toHaveBeenCalled()
        expect((await a.eventi.elenca(TENANT, FIR_ID))[0]).toMatchObject({
          operazione: 'Annotazione',
          esito: 'RIFIUTATA',
        })
      }
    )

    it('dettaglio dell ente non leggibile: nessuna decisione, nessuna firma, l INCERTA resta da riconciliare', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
      a.client.leggiFormulario.mockRejectedValue(new Error('ECONNRESET'))
      await invioSenzaEsito(a)

      await expect(a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })).rejects.toThrow(
        'ECONNRESET'
      )
      expect(a.completa.execute).not.toHaveBeenCalled()
      expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(1)
    })

    it('solo INVIATA (processo morto fra POST ed esito): riconciliata come un INCERTA', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione'],
        annotazioniEnte: [nostraNonFirmata()],
      })
      await invioSenzaEsito(a, { esito: 'INVIATA' })

      const esito = await a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })

      expect(esito.esito).toBe('COMPLETATA')
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
    })

    it('la riga INVIATA nasce PRIMA del POST; se non si riesce a scriverla il POST non parte', async () => {
      const a = ambiente()
      let invioPrimaDelPost: string | undefined
      a.client.inviaAnnotazione.mockImplementationOnce(async () => {
        invioPrimaDelPost = (await a.eventi.elenca(TENANT, FIR_ID))[0]?.esito
        return { errore: false, validazione: [], transazioneId: 'tr-an-1' }
      })
      await a.useCase.invia(comando())
      expect(invioPrimaDelPost).toBe('INVIATA')

      const b = ambiente()
      jest.spyOn(b.eventi, 'registra').mockRejectedValueOnce(new Error('db giu'))
      await expect(b.useCase.invia(comando())).rejects.toThrow('db giu')
      expect(b.client.inviaAnnotazione).not.toHaveBeenCalled()
      expect(await b.sessioni.trovaAperta(TENANT, FIR_ID)).toBeNull()
    })
  })

  describe('ripresa (R2): sempre dallo use case dell annotazione, riconciliazione prima di ogni authorize', () => {
    it('ripresa di una prenotazione ANNOTAZIONE_INVIO ancora viva: 409 SESSIONE_FIRMA_IN_CORSO, nessuna rete', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
      const prenotazione = await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: 'ANNOTAZIONE_INVIO',
        scadenza: new Date(Date.now() + 60_000),
      })

      await expect(
        a.useCase.riprendiInvio({ firId: FIR_ID, tenantId: TENANT, sessioneId: prenotazione.id })
      ).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
      expect(a.getAzioni.execute).not.toHaveBeenCalled()
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it('ripresa di una prenotazione ANNOTAZIONE_INVIO appesa: si chiude, si riconcilia, e si firma come ANNOTAZIONE (mai ANNOTAZIONE_INVIO)', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione'],
        annotazioniEnte: [
          { annotazione: 'Appesa', identificativo_soggetto: CF_TENANT, dati_firma: null },
        ],
      })
      const prenotazione = await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: 'ANNOTAZIONE_INVIO',
        scadenza: new Date(Date.now() - 1000),
      })
      const riga = await a.eventi.registra({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'Annotazione',
        payload: { annotazione: 'Appesa', identificativo_soggetto: CF_TENANT },
        transazioneId: null,
        esito: 'INVIATA',
        dettaglioEnte: null,
        statoFormularioDopo: null,
        utenteId: 'u1',
      })
      riga.createdAt = new Date(Date.now() - 3600_000)

      const esito = await a.useCase.riprendiInvio({
        firId: FIR_ID,
        tenantId: TENANT,
        sessioneId: prenotazione.id,
      })

      expect(esito.esito).toBe('COMPLETATA')
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect(a.completa.execute).toHaveBeenCalledWith(
        expect.objectContaining({ tipoOperazione: 'ANNOTAZIONE' })
      )
      expect((await a.sessioni.trovaPerId(TENANT, prenotazione.id))?.stato).toBe('ANNULLATA')
    })

    it('ripresa di una sessione di firma ANNOTAZIONE con l invio INCERTA: riconcilia e riprende la stessa sessione (una sola firma)', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione'],
        annotazioniEnte: [
          { annotazione: 'In firma', identificativo_soggetto: CF_TENANT, dati_firma: null },
        ],
      })
      await a.sessioni.apriInAttesa({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: 'ANNOTAZIONE',
        handle: 'h',
        tokenAcquisizione: 't',
        digestToSign: 'd',
        scadenza: new Date(Date.now() + 60_000),
      })
      const riga = await a.eventi.registra({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'Annotazione',
        payload: { annotazione: 'In firma', identificativo_soggetto: CF_TENANT },
        transazioneId: null,
        esito: 'INCERTA',
        dettaglioEnte: null,
        statoFormularioDopo: null,
        utenteId: 'u1',
      })
      riga.createdAt = new Date(Date.now() - 3600_000)

      const esito = await a.useCase.firma({ firId: FIR_ID, tenantId: TENANT })

      expect(esito.esito).toBe('COMPLETATA')
      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect((await a.eventi.elenca(TENANT, FIR_ID))[1]).toMatchObject({
        operazione: 'Annotazione',
        esito: 'ACCETTATA',
      })
    })
  })

  describe('terza verifica: R4 (firma solo se l ente conferma), R5, R6, R7', () => {
    const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
    const ente = (testo: string, cf = CF_TENANT, firmata = false) => ({
      annotazione: testo,
      identificativo_soggetto: cf,
      dati_firma: firmata ? { data_firma: '2026-11-20T09:00:00Z' } : null,
    })
    const firma = (a: ReturnType<typeof ambiente>) =>
      a.useCase.firma({ firId: FIR_ID, tenantId: TENANT, utenteId: 'u1' })

    it.each([
      [
        'l annotazione in attesa e di un altro soggetto',
        [ente('Testo del trasportatore', '99999999990')],
      ],
      ['nostro soggetto ma testo diverso da quello mostrato', [ente('Un altro testo')]],
      [
        'due annotazioni non firmate',
        [ente('Annotazione in sospeso'), ente('Annotazione in sospeso')],
      ],
      ['nessuna annotazione non firmata', [ente('Annotazione in sospeso', CF_TENANT, true)]],
    ])('R4: %s -> 409 ANNOTAZIONE_DI_ALTRO_SOGGETTO senza authorize', async (_n, presso) => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'], annotazioniEnte: presso })
      await annotazioneNostraInSospeso(a)

      await expect(firma(a)).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DI_ALTRO_SOGGETTO' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it('R4: dopo un Reset la nostra annotazione non e piu in sospeso, anche se lo storico la dava ACCETTATA', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione'],
        annotazioniEnte: [ente('Annotazione in sospeso')],
      })
      await annotazioneNostraInSospeso(a)
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

      await expect(firma(a)).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DI_ALTRO_SOGGETTO' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
    })

    it('R4: annotazione confermata dall ente (soggetto e hash): si firma una volta, legame con l hash del testo', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione'],
        annotazioniEnte: [ente('Vecchia firmata', CF_TENANT, true), ente('Annotazione in sospeso')],
      })
      await annotazioneNostraInSospeso(a)

      await firma(a)

      expect(a.completa.execute).toHaveBeenCalledTimes(1)
      expect((await a.eventi.elenca(TENANT, FIR_ID))[0].payload).toEqual(
        expect.objectContaining({ testoSha256: sha('Annotazione in sospeso') })
      )
    })

    async function incerta(a: ReturnType<typeof ambiente>, creato: Date) {
      const riga = await a.eventi.registra({
        tenantId: TENANT,
        firId: FIR_ID,
        operazione: 'Annotazione',
        payload: { annotazione: 'Senza esito', identificativo_soggetto: CF_TENANT },
        transazioneId: 'tx-incerta',
        esito: 'INCERTA',
        dettaglioEnte: 'polling esaurito',
        statoFormularioDopo: null,
        utenteId: 'u1',
      })
      riga.createdAt = creato
    }

    it('R5: transazione ancora in elaborazione presso l ente: 409 ANNOTAZIONE_IN_VERIFICA anche fuori dalla finestra, nessun POST', async () => {
      const a = ambiente({ annotazioniEnte: [] })
      a.client.leggiStatoTransazione.mockResolvedValue({ stato: 'IN_ELABORAZIONE' })
      await incerta(a, new Date(Date.now() - 24 * 3600_000))

      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_IN_VERIFICA' }),
      })
      expect(a.client.leggiStatoTransazione).toHaveBeenCalledWith(TENANT, 'tx-incerta')
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
    })

    it.each([
      ['non trovata', { stato: 'NON_TROVATA' }],
      ['completata in errore', { stato: 'COMPLETATA', esito: { errore: true, validazione: [] } }],
    ])(
      'R5: transazione %s: assente subito (senza aspettare la finestra), si reinvia',
      async (_n, statoTx) => {
        const a = ambiente({ annotazioniEnte: [] })
        a.client.leggiStatoTransazione.mockResolvedValue(statoTx)
        await incerta(a, new Date())

        await a.useCase.invia(comando())

        expect(a.client.inviaAnnotazione).toHaveBeenCalledTimes(1)
        const storico = (await a.eventi.elenca(TENANT, FIR_ID)).reverse()
        expect(storico[1]).toMatchObject({ operazione: 'Annotazione', esito: 'RIFIUTATA' })
      }
    )

    it('R5: un invio incerto con transazione nota salva il transazione_id nella riga INCERTA', async () => {
      const a = ambiente()
      a.client.inviaAnnotazione.mockRejectedValue(
        new TrasmissioneRentriIncertaError(
          'ESITO_NON_DISPONIBILE',
          undefined,
          'annotazione',
          'tx-9'
        )
      )
      await a.useCase.invia(comando()).catch(() => undefined)
      expect((await a.eventi.elenca(TENANT, FIR_ID))[0]).toMatchObject({
        esito: 'INCERTA',
        transazioneId: 'tx-9',
      })
    })

    it('R6: firma COMPLETATA ma l ente non mostra dati_firma: la riga della firma lo segnala', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione'],
        annotazioniEnte: [ente('Annotazione in sospeso')],
      })
      await annotazioneNostraInSospeso(a)

      await firma(a)

      expect((await a.eventi.elenca(TENANT, FIR_ID))[0].dettaglioEnte).toContain('dati_firma')
    })

    it('R6: firma COMPLETATA e annotazione firmata presso l ente: nessuna segnalazione', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
      await annotazioneNostraInSospeso(a)

      await firma(a)

      expect((await a.eventi.elenca(TENANT, FIR_ID))[0].dettaglioEnte).toBeNull()
    })

    it('R7: firma() mentre un altro processo sta inviando: 409 SESSIONE_FIRMA_IN_CORSO senza riconciliare (nessuna ACCETTATA doppia)', async () => {
      const a = ambiente({
        azioni: ['AcquisizioneFirmaAnnotazione'],
        annotazioniEnte: [ente('Senza esito')],
      })
      await incerta(a, new Date())
      await a.sessioni.prenota({
        tenantId: TENANT,
        firId: FIR_ID,
        tipoOperazione: 'ANNOTAZIONE_INVIO',
        scadenza: new Date(Date.now() + 60_000),
      })

      await expect(firma(a)).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'SESSIONE_FIRMA_IN_CORSO' }),
      })
      expect(a.client.leggiFormulario).not.toHaveBeenCalled()
      expect(await a.eventi.elenca(TENANT, FIR_ID)).toHaveLength(1)
      expect(a.completa.execute).not.toHaveBeenCalled()
    })
  })
})
