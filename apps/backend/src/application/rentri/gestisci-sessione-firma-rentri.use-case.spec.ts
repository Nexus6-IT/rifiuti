import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { GestisciSessioneFirmaRentriUseCase } from './gestisci-sessione-firma-rentri.use-case'
import { SessioniFirmaRentriInMemoria } from './sessioni-firma-rentri.in-memoria'

describe('GestisciSessioneFirmaRentriUseCase', () => {
  const TENANT = 'tenant-gs-1'

  async function ambiente(tipoOperazione = 'ANNULLAMENTO') {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT,
      rifiuto: { cerCode: '150101', quantita: 10 },
    })
    fir.emetti('FIR-GS-000001', { firmatario: 'X', timestamp: new Date(), certificato: 'c' })
    fir.markRENTRISynced('BCDFGH00050ZH')
    fir.applyRentriStato('FirmaAccettazione')
    const sessioni = new SessioniFirmaRentriInMemoria()
    const completa = { execute: jest.fn().mockResolvedValue({ esito: 'IN_ATTESA' }) }
    const logger: any = { setContext: jest.fn(), info: jest.fn(), debug: jest.fn() }
    const firmaPartenza = {
      execute: jest.fn().mockResolvedValue({
        operazione: 'AcquisizioneFirmaTrasportatore',
        firma: { esito: 'IN_ATTESA', handle: 'h' },
      }),
    }
    const annotazione = {
      firma: jest.fn().mockResolvedValue({ esito: 'IN_ATTESA', handle: 'h-an' }),
      riprendiInvio: jest.fn().mockResolvedValue({ esito: 'IN_ATTESA', handle: 'h-inv' }),
    }
    const sostaTecnica = {
      firma: jest.fn().mockResolvedValue({ esito: 'IN_ATTESA', handle: 'h-st' }),
      riprendiInvio: jest.fn().mockResolvedValue({ esito: 'IN_ATTESA', handle: 'h-st-inv' }),
    }
    const trasbordoTotale = {
      firma: jest.fn().mockResolvedValue({ esito: 'IN_ATTESA', handle: 'h-tt' }),
      riprendiInvio: jest.fn().mockResolvedValue({ esito: 'IN_ATTESA', handle: 'h-tt-inv' }),
    }
    const useCase = new GestisciSessioneFirmaRentriUseCase(
      { findById: jest.fn().mockResolvedValue(fir) } as any,
      sessioni,
      completa as any,
      logger,
      firmaPartenza as any,
      annotazione as any,
      sostaTecnica as any,
      trasbordoTotale as any
    )
    const sessione = await sessioni.apriInAttesa({
      tenantId: TENANT,
      firId: 'fir-1',
      tipoOperazione: tipoOperazione,
      handle: 'h',
      tokenAcquisizione: 'SEGRETO',
      digestToSign: 'd',
      scadenza: new Date(Date.now() + 60_000),
    })
    return {
      useCase,
      sessioni,
      completa,
      sessione,
      fir,
      firmaPartenza,
      annotazione,
      sostaTecnica,
      trasbordoTotale,
    }
  }

  it('inAttesa espone id, operazione e scadenza, MAI token, digest o handle', async () => {
    const { useCase, sessione } = await ambiente()
    const v = await useCase.inAttesa('fir-1', TENANT)
    expect(v).toEqual({
      id: sessione.id,
      tipoOperazione: 'ANNULLAMENTO',
      scadenza: sessione.scadenza,
      stato: 'IN_ATTESA',
      scaduta: false,
    })
    expect(JSON.stringify(v)).not.toContain('SEGRETO')
  })

  it('inAttesa segnala scaduta=true se il limite e passato, e null senza sessione', async () => {
    const { useCase, sessioni } = await ambiente()
    sessioni.righe[0].scadenza = new Date(Date.now() - 1)
    expect((await useCase.inAttesa('fir-1', TENANT))?.scaduta).toBe(true)
    sessioni.righe[0].stato = 'COMPLETATA'
    expect(await useCase.inAttesa('fir-1', TENANT)).toBeNull()
  })

  it('riprendi su sessione aperta delega a Completa con l operazione della sessione', async () => {
    const { useCase, completa, sessione } = await ambiente()
    await useCase.riprendi({
      firId: 'fir-1',
      tenantId: TENANT,
      sessioneId: sessione.id,
      utenteId: 'u',
    })
    expect(completa.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoOperazione: 'ANNULLAMENTO',
        firId: 'fir-1',
        nuovaSessione: undefined,
      })
    )
  })

  it('sessione SCADUTA: restituisce l esito senza chiamare l ente, tranne con nuovaSessione', async () => {
    const { useCase, completa, sessione, sessioni } = await ambiente()
    await sessioni.chiudi(TENANT, sessione.id, 'SCADUTA')
    const r = await useCase.riprendi({ firId: 'fir-1', tenantId: TENANT, sessioneId: sessione.id })
    expect(r).toMatchObject({ esito: 'SCADUTA', sessioneId: sessione.id })
    expect(completa.execute).not.toHaveBeenCalled()

    await useCase.riprendi({
      firId: 'fir-1',
      tenantId: TENANT,
      sessioneId: sessione.id,
      nuovaSessione: true,
    })
    expect(completa.execute).toHaveBeenCalledWith(expect.objectContaining({ nuovaSessione: true }))
  })

  it('sessione COMPLETATA/ANNULLATA: SESSIONE_FIRMA_NON_ATTIVA; altro FIR o altro tenant: not found', async () => {
    const { useCase, sessione, sessioni } = await ambiente()
    await sessioni.chiudi(TENANT, sessione.id, 'ANNULLATA')
    await expect(
      useCase.riprendi({ firId: 'fir-1', tenantId: TENANT, sessioneId: sessione.id })
    ).rejects.toMatchObject({ metadata: { rule: 'SESSIONE_FIRMA_NON_ATTIVA' } })
    await expect(
      useCase.riprendi({ firId: 'fir-2', tenantId: TENANT, sessioneId: sessione.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('I3: dopo SCADUTA o RIFIUTATA il banner resta (ultima sessione), con scaduta=true', async () => {
    const { useCase, sessioni, sessione } = await ambiente()
    await sessioni.chiudi(TENANT, sessione.id, 'SCADUTA')
    expect(await useCase.inAttesa('fir-1', TENANT)).toMatchObject({
      id: sessione.id,
      stato: 'SCADUTA',
      scaduta: true,
    })
    const altra = await sessioni.apriInAttesa({
      tenantId: TENANT,
      firId: 'fir-1',
      tipoOperazione: 'ANNULLAMENTO',
      scadenza: new Date(Date.now() + 60_000),
    })
    await sessioni.chiudi(TENANT, altra.id, 'RIFIUTATA')
    expect(await useCase.inAttesa('fir-1', TENANT)).toMatchObject({
      id: altra.id,
      stato: 'RIFIUTATA',
      scaduta: true,
    })
  })

  it('I3: COMPLETATA o ANNULLATA piu recenti fanno sparire il banner', async () => {
    const { useCase, sessioni, sessione } = await ambiente()
    await sessioni.chiudi(TENANT, sessione.id, 'ANNULLATA')
    expect(await useCase.inAttesa('fir-1', TENANT)).toBeNull()
  })

  it('M1: nuovaSessione su una sessione COMPLETATA o ANNULLATA e rifiutata senza chiamare l ente', async () => {
    const { useCase, completa, sessione, sessioni } = await ambiente()
    await sessioni.chiudi(TENANT, sessione.id, 'ANNULLATA')
    await expect(
      useCase.riprendi({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: sessione.id,
        nuovaSessione: true,
      })
    ).rejects.toMatchObject({ metadata: { rule: 'SESSIONE_FIRMA_NON_ATTIVA' } })
    expect(completa.execute).not.toHaveBeenCalled()
  })

  it('R1: dopo un reset (FIR fuori da Firma*) una sessione SCADUTA/RIFIUTATA non tiene piu il banner', async () => {
    const { useCase, sessioni, sessione, fir } = await ambiente()
    await sessioni.chiudi(TENANT, sessione.id, 'SCADUTA')
    expect(await useCase.inAttesa('fir-1', TENANT)).not.toBeNull()

    fir.applyRentriStato('InserimentoAccettazione')

    expect(await useCase.inAttesa('fir-1', TENANT)).toBeNull()
  })

  describe('sessioni di firma di partenza (I1)', () => {
    it.each([
      ['PARTENZA_TRASPORTATORE', 'AcquisizioneFirmaTrasportatore'],
      ['PARTENZA_PRODUTTORE', 'AcquisizioneFirmaProduttore'],
      ['PARTENZA_PRODUTTORE_TRASPORTATORE', 'AcquisizioneFirmaProduttoreTrasportatore'],
    ])(
      'riprendi su %s passa da FirmaPartenzaRentriUseCase (storico e /azioni), non dal ciclo comune',
      async (tipo, operazione) => {
        const { useCase, completa, firmaPartenza, sessione } = await ambiente(tipo)
        sessione.firId = 'fir-1'

        const esito = await useCase.riprendi({
          firId: 'fir-1',
          tenantId: TENANT,
          sessioneId: sessione.id,
          utenteId: 'u1',
          nuovaSessione: false,
        })

        expect(firmaPartenza.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            firId: 'fir-1',
            tenantId: TENANT,
            utenteId: 'u1',
            ammesse: [operazione],
          })
        )
        expect(completa.execute).not.toHaveBeenCalled()
        expect(esito).toEqual({ esito: 'IN_ATTESA', handle: 'h' })
      }
    )

    it('«Richiedi di nuovo» (nuovaSessione) su una sessione PARTENZA scaduta ricontrolla /azioni tramite lo use case di partenza', async () => {
      const { useCase, sessioni, firmaPartenza, sessione } =
        await ambiente('PARTENZA_TRASPORTATORE')
      sessioni.righe[0].stato = 'SCADUTA'

      await useCase.riprendi({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: sessione.id,
        nuovaSessione: true,
      })

      expect(firmaPartenza.execute).toHaveBeenCalledWith(
        expect.objectContaining({ nuovaSessione: true })
      )
    })

    it('una sessione di un altra operazione continua a passare dal ciclo comune', async () => {
      const { useCase, completa, firmaPartenza, sessione } = await ambiente('ACCETTAZIONE')

      await useCase.riprendi({ firId: 'fir-1', tenantId: TENANT, sessioneId: sessione.id })

      expect(completa.execute).toHaveBeenCalledTimes(1)
      expect(firmaPartenza.execute).not.toHaveBeenCalled()
    })
  })

  describe('sessioni di firma dell annotazione (FIR in viaggio P4)', () => {
    it('riprendi su ANNOTAZIONE passa da AnnotazioneRentriUseCase.firma (storico e /azioni), non dal ciclo comune', async () => {
      const { useCase, completa, firmaPartenza, annotazione, sessione } =
        await ambiente('ANNOTAZIONE')

      const esito = await useCase.riprendi({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: sessione.id,
        utenteId: 'u1',
        nuovaSessione: false,
        correlationId: 'c1',
      })

      expect(annotazione.firma).toHaveBeenCalledWith({
        firId: 'fir-1',
        tenantId: TENANT,
        utenteId: 'u1',
        nuovaSessione: false,
        correlationId: 'c1',
      })
      expect(completa.execute).not.toHaveBeenCalled()
      expect(firmaPartenza.execute).not.toHaveBeenCalled()
      expect(esito).toEqual({ esito: 'IN_ATTESA', handle: 'h-an' })
    })

    it('«Richiedi di nuovo» su una sessione ANNOTAZIONE scaduta ricontrolla /azioni tramite lo use case dell annotazione', async () => {
      const { useCase, sessioni, annotazione, sessione } = await ambiente('ANNOTAZIONE')
      sessioni.righe[0].stato = 'SCADUTA'

      await useCase.riprendi({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: sessione.id,
        nuovaSessione: true,
      })

      expect(annotazione.firma).toHaveBeenCalledWith(
        expect.objectContaining({ nuovaSessione: true })
      )
    })
  })

  describe('prenotazione dell invio di un annotazione (ANNOTAZIONE_INVIO, R2)', () => {
    async function conPrenotazioneInvio(scadenza: Date) {
      const a = await ambiente()
      a.sessioni.righe.length = 0
      const prenotazione = await a.sessioni.prenota({
        tenantId: TENANT,
        firId: 'fir-1',
        tipoOperazione: 'ANNOTAZIONE_INVIO',
        scadenza,
      })
      return { ...a, prenotazione }
    }

    it('inAttesa NON mostra la prenotazione dell invio: non e una firma da confermare sul telefono', async () => {
      const { useCase } = await conPrenotazioneInvio(new Date(Date.now() + 60_000))
      expect(await useCase.inAttesa('fir-1', TENANT)).toBeNull()

      const b = await conPrenotazioneInvio(new Date(Date.now() - 1))
      expect(await b.useCase.inAttesa('fir-1', TENANT)).toBeNull()
    })

    it.each([
      ['viva', 60_000],
      ['appesa (processo morto)', -1],
    ])(
      'riprendi di una prenotazione %s passa SEMPRE dallo use case dell annotazione, mai dal ciclo comune',
      async (_n, deltaMs) => {
        const { useCase, completa, firmaPartenza, annotazione, prenotazione } =
          await conPrenotazioneInvio(new Date(Date.now() + deltaMs))

        const esito = await useCase.riprendi({
          firId: 'fir-1',
          tenantId: TENANT,
          sessioneId: prenotazione.id,
          utenteId: 'u1',
          nuovaSessione: true,
          correlationId: 'c1',
        })

        expect(annotazione.riprendiInvio).toHaveBeenCalledWith({
          firId: 'fir-1',
          tenantId: TENANT,
          sessioneId: prenotazione.id,
          utenteId: 'u1',
          correlationId: 'c1',
        })
        expect(completa.execute).not.toHaveBeenCalled()
        expect(annotazione.firma).not.toHaveBeenCalled()
        expect(firmaPartenza.execute).not.toHaveBeenCalled()
        expect(esito).toEqual({ esito: 'IN_ATTESA', handle: 'h-inv' })
      }
    )
  })
  describe('sosta tecnica (FIR in viaggio P5)', () => {
    it('riprendi su SOSTA_TECNICA passa da SostaTecnicaRentriUseCase.firma, non dal ciclo comune ne dall annotazione', async () => {
      const { useCase, completa, annotazione, sostaTecnica, sessione } =
        await ambiente('SOSTA_TECNICA')

      const esito = await useCase.riprendi({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: sessione.id,
        utenteId: 'u1',
        nuovaSessione: true,
        correlationId: 'c1',
      })

      expect(sostaTecnica.firma).toHaveBeenCalledWith({
        firId: 'fir-1',
        tenantId: TENANT,
        utenteId: 'u1',
        nuovaSessione: true,
        correlationId: 'c1',
      })
      expect(completa.execute).not.toHaveBeenCalled()
      expect(annotazione.firma).not.toHaveBeenCalled()
      expect(esito).toEqual({ esito: 'IN_ATTESA', handle: 'h-st' })
    })

    it('la prenotazione dell invio (SOSTA_TECNICA_INVIO) non e un banner e si riprende SEMPRE dallo use case della sosta', async () => {
      const a = await ambiente()
      a.sessioni.righe.length = 0
      const prenotazione = await a.sessioni.prenota({
        tenantId: TENANT,
        firId: 'fir-1',
        tipoOperazione: 'SOSTA_TECNICA_INVIO',
        scadenza: new Date(Date.now() + 60_000),
      })
      expect(await a.useCase.inAttesa('fir-1', TENANT)).toBeNull()

      const esito = await a.useCase.riprendi({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: prenotazione.id,
        utenteId: 'u1',
        correlationId: 'c1',
      })

      expect(a.sostaTecnica.riprendiInvio).toHaveBeenCalledWith({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: prenotazione.id,
        utenteId: 'u1',
        correlationId: 'c1',
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
      expect(a.sostaTecnica.firma).not.toHaveBeenCalled()
      expect(a.annotazione.riprendiInvio).not.toHaveBeenCalled()
      expect(esito).toEqual({ esito: 'IN_ATTESA', handle: 'h-st-inv' })
    })
  })

  describe('trasbordo totale (FIR in viaggio P6)', () => {
    it('riprendi su TRASBORDO_TOTALE passa da TrasbordoTotaleRentriUseCase.firma, non dal ciclo comune', async () => {
      const { useCase, completa, sostaTecnica, trasbordoTotale, sessione } =
        await ambiente('TRASBORDO_TOTALE')

      const esito = await useCase.riprendi({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: sessione.id,
        utenteId: 'u1',
        nuovaSessione: true,
        correlationId: 'c1',
      })

      expect(trasbordoTotale.firma).toHaveBeenCalledWith({
        firId: 'fir-1',
        tenantId: TENANT,
        utenteId: 'u1',
        nuovaSessione: true,
        correlationId: 'c1',
      })
      expect(completa.execute).not.toHaveBeenCalled()
      expect(sostaTecnica.firma).not.toHaveBeenCalled()
      expect(esito).toEqual({ esito: 'IN_ATTESA', handle: 'h-tt' })
    })

    it('la prenotazione dell invio (TRASBORDO_TOTALE_INVIO) non e un banner e si riprende SEMPRE dallo use case del trasbordo', async () => {
      const a = await ambiente()
      a.sessioni.righe.length = 0
      const prenotazione = await a.sessioni.prenota({
        tenantId: TENANT,
        firId: 'fir-1',
        tipoOperazione: 'TRASBORDO_TOTALE_INVIO',
        scadenza: new Date(Date.now() + 60_000),
      })
      expect(await a.useCase.inAttesa('fir-1', TENANT)).toBeNull()

      const esito = await a.useCase.riprendi({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: prenotazione.id,
        utenteId: 'u1',
        correlationId: 'c1',
      })

      expect(a.trasbordoTotale.riprendiInvio).toHaveBeenCalledWith({
        firId: 'fir-1',
        tenantId: TENANT,
        sessioneId: prenotazione.id,
        utenteId: 'u1',
        correlationId: 'c1',
      })
      expect(a.completa.execute).not.toHaveBeenCalled()
      expect(a.trasbordoTotale.firma).not.toHaveBeenCalled()
      expect(a.sostaTecnica.riprendiInvio).not.toHaveBeenCalled()
      expect(esito).toEqual({ esito: 'IN_ATTESA', handle: 'h-tt-inv' })
    })
  })
})
