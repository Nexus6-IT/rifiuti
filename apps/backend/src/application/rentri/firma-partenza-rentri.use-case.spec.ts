import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { DomainException } from '../../domain/shared/domain-exception'
import {
  FirmaPartenzaRentriUseCase,
  TIPO_OPERAZIONE_PARTENZA,
} from './firma-partenza-rentri.use-case'
import { EventiFirRentriInMemoria } from './eventi-fir-rentri.in-memoria'

/**
 * FIR in viaggio P3, T0 — firma di partenza: l'operazione la sceglie `/azioni`, la firma passa dal ciclo
 * comune (sessione riprendibile di P1), ogni esito lascia una riga nello storico, e dopo un'azione
 * locale l'esito della firma non annulla mai l'azione.
 */
describe('FirmaPartenzaRentriUseCase', () => {
  const TENANT = 'tenant-p3-1'
  const NUMERO_FIR = 'BCDFGH00031ZH'

  function creaFir(legato = true): FIR {
    const fir = FIR.create({
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      tenantId: TENANT,
      rifiuto: { cerCode: '150101', quantita: 10 },
    })
    fir.emetti('FIR-P3-000001', { firmatario: 'X', timestamp: new Date(), certificato: 'c' })
    if (legato) fir.markRENTRISynced(NUMERO_FIR)
    return fir
  }

  function ambiente(opzioni: { azioni?: string[]; legato?: boolean } = {}) {
    const fir = creaFir(opzioni.legato ?? true)
    const eventi = new EventiFirRentriInMemoria()
    const firRepository = { findById: jest.fn().mockResolvedValue(fir) }
    const azioni = opzioni.azioni ?? ['AcquisizioneFirmaProduttoreTrasportatore', 'Reset']
    const getAzioni = {
      execute: jest.fn().mockResolvedValue({
        stato: 'FirmaProduttoreTrasportatoreIniziale',
        azioni: azioni.map(operazione => ({ operazione })),
      }),
    }
    const completa = {
      execute: jest
        .fn()
        .mockResolvedValue({ esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' }),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const useCase = new FirmaPartenzaRentriUseCase(
      firRepository as any,
      getAzioni as any,
      completa as any,
      eventi,
      logger
    )
    return { useCase, firRepository, getAzioni, completa, eventi, logger, fir }
  }

  const comando = { firId: 'fir-1', tenantId: TENANT, utenteId: 'u-1' }

  describe('execute', () => {
    it('FIR inesistente: 404 senza chiamare l ente', async () => {
      const { useCase, firRepository, getAzioni, completa } = ambiente()
      firRepository.findById.mockResolvedValue(null)

      await expect(useCase.execute(comando)).rejects.toMatchObject({ code: 'NOT_FOUND' })

      expect(getAzioni.execute).not.toHaveBeenCalled()
      expect(completa.execute).not.toHaveBeenCalled()
    })

    it('FIR di un altro tenant: non autorizzato', async () => {
      const { useCase } = ambiente()

      await expect(useCase.execute({ ...comando, tenantId: 'altro' })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })

    it('FIR non legato a RENTRI: FIR_NON_LEGATO_RENTRI, nessuna chiamata', async () => {
      const { useCase, getAzioni, completa } = ambiente({ legato: false })

      await expect(useCase.execute(comando)).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIR_NON_LEGATO_RENTRI' }),
      })

      expect(getAzioni.execute).not.toHaveBeenCalled()
      expect(completa.execute).not.toHaveBeenCalled()
    })

    it('firma completata: sceglie l operazione da /azioni, passa dal ciclo comune e registra ACCETTATA', async () => {
      const { useCase, completa, eventi, getAzioni } = ambiente()

      const esito = await useCase.execute({ ...comando, correlationId: 'c-1' })

      expect(getAzioni.execute).toHaveBeenCalledWith('fir-1', TENANT, 'c-1')
      expect(completa.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          firId: 'fir-1',
          tenantId: TENANT,
          tipoOperazione: TIPO_OPERAZIONE_PARTENZA,
          utenteId: 'u-1',
          correlationId: 'c-1',
        })
      )
      expect(esito).toEqual({
        operazione: 'AcquisizioneFirmaProduttoreTrasportatore',
        firma: { esito: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
      })
      const storico = await eventi.elenca(TENANT, 'fir-1')
      expect(storico).toHaveLength(1)
      expect(storico[0]).toMatchObject({
        operazione: 'AcquisizioneFirmaProduttoreTrasportatore',
        esito: 'ACCETTATA',
        statoFormularioDopo: 'InserimentoAccettazione',
        utenteId: 'u-1',
      })
    })

    it.each([
      [['AcquisizioneFirmaTrasportatore'], 'AcquisizioneFirmaTrasportatore'],
      [['AcquisizioneFirmaProduttore'], 'AcquisizioneFirmaProduttore'],
      [
        ['AcquisizioneFirmaTrasportatore', 'AcquisizioneFirmaProduttore'],
        'AcquisizioneFirmaProduttore',
      ],
      [
        ['AcquisizioneFirmaProduttore', 'AcquisizioneFirmaProduttoreTrasportatore'],
        'AcquisizioneFirmaProduttoreTrasportatore',
      ],
    ])('azioni %j: l operazione scelta e %s', async (azioni, atteso) => {
      const { useCase } = ambiente({ azioni })

      const esito = await useCase.execute(comando)

      expect(esito.operazione).toBe(atteso)
    })

    it('nessuna firma di partenza in /azioni: 409 senza firma ne evento', async () => {
      const { useCase, completa, eventi } = ambiente({ azioni: ['DatiQuantita', 'Reset'] })

      await expect(useCase.execute(comando)).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIRMA_PARTENZA_NON_DISPONIBILE' }),
      })

      expect(completa.execute).not.toHaveBeenCalled()
      expect(await eventi.elenca(TENANT, 'fir-1')).toHaveLength(0)
    })

    it('la firma di accettazione in /azioni non e una firma di partenza', async () => {
      const { useCase, completa } = ambiente({ azioni: ['AcquisizioneFirmaDestinatario'] })

      await expect(useCase.execute(comando)).rejects.toMatchObject({
        metadata: expect.objectContaining({ rule: 'FIRMA_PARTENZA_NON_DISPONIBILE' }),
      })
      expect(completa.execute).not.toHaveBeenCalled()
    })

    it('in attesa di conferma sul telefono: esito propagato, evento INVIATA', async () => {
      const { useCase, completa, eventi } = ambiente()
      const scadenza = new Date(Date.now() + 100_000)
      completa.execute.mockResolvedValue({
        esito: 'IN_ATTESA',
        handle: 'h',
        sessioneId: 's-1',
        scadenzaAutorizzazione: scadenza,
      })

      const esito = await useCase.execute(comando)

      expect(esito.firma).toMatchObject({ esito: 'IN_ATTESA', sessioneId: 's-1' })
      const storico = await eventi.elenca(TENANT, 'fir-1')
      expect(storico).toHaveLength(1)
      expect(storico[0]).toMatchObject({ esito: 'INVIATA', statoFormularioDopo: null })
    })

    it.each([
      [{ esito: 'SCADUTA', handle: 'h', rilevataDa: 'ente' }],
      [{ esito: 'RIFIUTATA', handle: 'h', dettaglioEnte: 'no' }],
    ])('firma %j: evento RIFIUTATA, esito propagato', async firma => {
      const { useCase, completa, eventi } = ambiente()
      completa.execute.mockResolvedValue(firma)

      const esito = await useCase.execute(comando)

      expect(esito.firma.esito).toBe(firma.esito)
      expect((await eventi.elenca(TENANT, 'fir-1'))[0]).toMatchObject({ esito: 'RIFIUTATA' })
    })

    it('rifiuto dell ente sulla firma (FIRMA_RENTRI_RIFIUTATA): evento RIFIUTATA e errore originale', async () => {
      const { useCase, completa, eventi } = ambiente()
      const errore = DomainException.businessRuleViolation('FIRMA_RENTRI_RIFIUTATA', 'rifiutata')
      completa.execute.mockRejectedValue(errore)

      await expect(useCase.execute(comando)).rejects.toBe(errore)

      expect((await eventi.elenca(TENANT, 'fir-1'))[0]).toMatchObject({ esito: 'RIFIUTATA' })
    })

    it('errore imprevisto (rete): evento INCERTA e errore originale', async () => {
      const { useCase, completa, eventi } = ambiente()
      const errore = new Error('ECONNRESET')
      completa.execute.mockRejectedValue(errore)

      await expect(useCase.execute(comando)).rejects.toBe(errore)

      expect((await eventi.elenca(TENANT, 'fir-1'))[0]).toMatchObject({ esito: 'INCERTA' })
    })

    it('sessione di firma gia in corso: 409 senza evento (non e un esito dell ente)', async () => {
      const { useCase, completa, eventi } = ambiente()
      const errore = DomainException.businessRuleViolation('SESSIONE_FIRMA_IN_CORSO', 'in corso')
      completa.execute.mockRejectedValue(errore)

      await expect(useCase.execute(comando)).rejects.toBe(errore)

      expect(await eventi.elenca(TENANT, 'fir-1')).toHaveLength(0)
    })

    it('un errore dello storico non maschera l esito della firma', async () => {
      const { useCase, eventi, logger } = ambiente()
      jest.spyOn(eventi, 'registra').mockRejectedValue(new Error('db giu'))

      const esito = await useCase.execute(comando)

      expect(esito.firma.esito).toBe('COMPLETATA')
      expect(logger.error).toHaveBeenCalled()
    })

    it('inoltra nuovaSessione al ciclo comune', async () => {
      const { useCase, completa } = ambiente()

      await useCase.execute({ ...comando, nuovaSessione: true })

      expect(completa.execute).toHaveBeenCalledWith(expect.objectContaining({ nuovaSessione: true }))
    })

    it('doppia firma: due richieste in sequenza chiamano due volte il ciclo comune, che e l unico a decidere (sessione unica)', async () => {
      const { useCase, completa } = ambiente()
      completa.execute
        .mockResolvedValueOnce({
          esito: 'IN_ATTESA',
          handle: 'h',
          sessioneId: 's-1',
          scadenzaAutorizzazione: new Date(Date.now() + 100_000),
        })
        .mockResolvedValueOnce({
          esito: 'IN_ATTESA',
          handle: 'h',
          sessioneId: 's-1',
          scadenzaAutorizzazione: new Date(Date.now() + 100_000),
        })

      const a = await useCase.execute(comando)
      const b = await useCase.execute(comando)

      // Nessuna logica di sessione duplicata qui: stessa sessione restituita dal ciclo comune.
      expect(a.firma).toMatchObject({ sessioneId: 's-1' })
      expect(b.firma).toMatchObject({ sessioneId: 's-1' })
      expect(
        completa.execute.mock.calls.every(c => c[0].tipoOperazione === TIPO_OPERAZIONE_PARTENZA)
      ).toBe(true)
    })
  })

  describe('dopoAzioneLocale (Emetti / Presa in carico: la firma RENTRI non annulla mai l azione locale)', () => {
    it('FIR non legato (flusso cartaceo): NON_APPLICABILE, nessuna chiamata all ente', async () => {
      const { useCase, getAzioni, completa } = ambiente({ legato: false })

      const esito = await useCase.dopoAzioneLocale(comando)

      expect(esito).toEqual({ stato: 'NON_APPLICABILE' })
      expect(getAzioni.execute).not.toHaveBeenCalled()
      expect(completa.execute).not.toHaveBeenCalled()
    })

    it('azione locale riuscita e firma RENTRI riuscita: COMPLETATA con lo stato riletto', async () => {
      const { useCase } = ambiente()

      const esito = await useCase.dopoAzioneLocale(comando)

      expect(esito).toEqual({ stato: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' })
    })

    it('azione locale riuscita e firma in attesa del telefono: IN_ATTESA con la sessione', async () => {
      const { useCase, completa } = ambiente()
      const scadenza = new Date(Date.now() + 100_000)
      completa.execute.mockResolvedValue({
        esito: 'IN_ATTESA',
        handle: 'h',
        sessioneId: 's-9',
        scadenzaAutorizzazione: scadenza,
      })

      const esito = await useCase.dopoAzioneLocale(comando)

      expect(esito).toEqual({ stato: 'IN_ATTESA', sessioneId: 's-9', scadenza })
    })

    it('azione locale riuscita e firma RENTRI fallita: nessuna eccezione, avviso «firma RENTRI da completare»', async () => {
      const { useCase, completa, logger } = ambiente()
      completa.execute.mockRejectedValue(new Error('ECONNRESET'))

      const esito = await useCase.dopoAzioneLocale(comando)

      expect(esito).toMatchObject({ stato: 'DA_COMPLETARE' })
      expect((esito as { avviso: string }).avviso).toMatch(/firma RENTRI da completare/i)
      expect(logger.warn).toHaveBeenCalled()
    })

    it('firma rifiutata dall ente: DA_COMPLETARE con il codice, mai un errore', async () => {
      const { useCase, completa } = ambiente()
      completa.execute.mockRejectedValue(
        DomainException.businessRuleViolation('FIRMA_RENTRI_RIFIUTATA', 'rifiutata')
      )

      const esito = await useCase.dopoAzioneLocale(comando)

      expect(esito).toMatchObject({ stato: 'DA_COMPLETARE', codice: 'FIRMA_RENTRI_RIFIUTATA' })
    })

    it('ente non pronto (mancano quantita o trasporto): DA_COMPLETARE con il motivo', async () => {
      const { useCase, completa } = ambiente({ azioni: ['DatiQuantita'] })

      const esito = await useCase.dopoAzioneLocale(comando)

      expect(esito).toMatchObject({
        stato: 'DA_COMPLETARE',
        codice: 'FIRMA_PARTENZA_NON_DISPONIBILE',
      })
      expect(completa.execute).not.toHaveBeenCalled()
    })

    it.each([
      [{ esito: 'SCADUTA', handle: 'h', sessioneId: 's-2', rilevataDa: 'orologio-locale' }, 'SCADUTA'],
      [{ esito: 'RIFIUTATA', handle: 'h', sessioneId: 's-3', dettaglioEnte: 'no' }, 'RIFIUTATA'],
    ])('firma %j: stato %s con avviso e sessione, mai un errore', async (firma, atteso) => {
      const { useCase, completa } = ambiente()
      completa.execute.mockResolvedValue(firma)

      const esito = await useCase.dopoAzioneLocale(comando)

      expect(esito).toMatchObject({ stato: atteso, sessioneId: (firma as any).sessioneId })
      expect((esito as { avviso: string }).avviso).toMatch(/firma RENTRI da completare/i)
    })

    it('anche una lettura del FIR che fallisce non diventa un errore dell azione locale', async () => {
      const { useCase, firRepository } = ambiente()
      firRepository.findById.mockRejectedValue(new Error('db giu'))

      const esito = await useCase.dopoAzioneLocale(comando)

      expect(esito).toMatchObject({ stato: 'DA_COMPLETARE' })
    })
  })

  describe('eLegatoRentri', () => {
    it('vero solo per un FIR dell azienda legato a RENTRI', async () => {
      expect(await ambiente().useCase.eLegatoRentri('fir-1', TENANT)).toBe(true)
      expect(await ambiente({ legato: false }).useCase.eLegatoRentri('fir-1', TENANT)).toBe(false)
      expect(await ambiente().useCase.eLegatoRentri('fir-1', 'altro')).toBe(false)
    })

    it('FIR inesistente: falso (si lascia decidere al flusso locale)', async () => {
      const { useCase, firRepository } = ambiente()
      firRepository.findById.mockResolvedValue(null)

      expect(await useCase.eLegatoRentri('fir-1', TENANT)).toBe(false)
    })
  })
})
