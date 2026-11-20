import { FIR, ParteFIR } from '../../domain/fir/aggregates/fir.aggregate'
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
      produttore: opzioni.produttore ?? parte(CF_TENANT),
      trasportatore: opzioni.trasportatore ?? parte('11111111119'),
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
      ['produttore (P.IVA con prefisso IT)', { produttore: parte('IT' + CF_TENANT) }],
      ['produttore (codice fiscale)', { produttore: parte('', CF_TENANT.toLowerCase()) }],
      ['trasportatore', { produttore: parte('33333333335'), trasportatore: parte(CF_TENANT) }],
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

    it('annotazione gia in attesa di firma: ANNOTAZIONE_DA_FIRMARE (nessuna doppia annotazione)', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione', 'Reset'] })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_DA_FIRMARE' }),
      })
      expect(a.client.inviaAnnotazione).not.toHaveBeenCalled()
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
        ['Annotazione', 'ACCETTATA'],
        ['AcquisizioneFirmaAnnotazione', 'ACCETTATA'],
      ])
      expect(storico[0].payload).toEqual({
        annotazione: 'Il carico e stato pesato due volte',
        identificativo_soggetto: CF_TENANT,
      })
      expect(storico[0].transazioneId).toBe('tr-an-1')
    })

    it('rifiuto dell ente (esito.errore): ANNOTAZIONE_RENTRI_RIFIUTATA, evento RIFIUTATA, nessuna firma', async () => {
      const a = ambiente({
        esito: { errore: true, validazione: [{ campo: 'annotazione' }], transazioneId: 'tr-x' },
      })
      await expect(a.useCase.invia(comando())).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'ANNOTAZIONE_RENTRI_RIFIUTATA' }),
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
      const storico = await a.eventi.elenca(TENANT, FIR_ID)
      expect(storico.map(e => [e.operazione, e.esito])).toEqual([['Annotazione', 'RIFIUTATA']])
    })

    it('4xx definitivo: RIFIUTATA; errore di rete: INCERTA e errore originale', async () => {
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
      await expect(b.useCase.invia(comando())).rejects.toBe(rete)
      expect((await b.eventi.elenca(TENANT, FIR_ID))[0].esito).toBe('INCERTA')
      expect(b.completa.execute).not.toHaveBeenCalled()
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
      expect((await a.eventi.elenca(TENANT, FIR_ID))[0]).toMatchObject({
        operazione: 'AcquisizioneFirmaAnnotazione',
        esito: 'ACCETTATA',
      })
    })

    it('firma rifiutata dall ente (eccezione FIRMA_RENTRI_RIFIUTATA): RIFIUTATA nello storico, eccezione propagata', async () => {
      const a = ambiente({ azioni: ['AcquisizioneFirmaAnnotazione'] })
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
})
