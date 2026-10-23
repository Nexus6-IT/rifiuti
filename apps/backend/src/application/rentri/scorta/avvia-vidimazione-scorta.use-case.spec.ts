import { NotFoundException } from '@nestjs/common'
import { AvviaVidimazioneScortaUseCase } from './avvia-vidimazione-scorta.use-case'

describe('AvviaVidimazioneScortaUseCase', () => {
  const TENANT = 'tenant-1'

  function build(overrides: { blocchiEsistenti?: unknown[] } = {}) {
    const vidimazioneClient = {
      vidimaFir: jest.fn(),
      attendiEsitoVidimazione: jest.fn(),
      elencaBlocchi: jest.fn().mockResolvedValue({
        risultati: overrides.blocchiEsistenti ?? [{ codice_blocco: 'BLK-A' }],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 0 },
      }),
    }
    const scortaRepo = {
      inserisciDisponibile: jest.fn().mockResolvedValue(undefined),
    }
    const logger = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ codiceFiscale: 'RSSMRA80A01H501U' }),
      },
    }
    return {
      useCase: new AvviaVidimazioneScortaUseCase(
        vidimazioneClient as any,
        scortaRepo as any,
        logger as any,
        prisma as any
      ),
      vidimazioneClient,
      scortaRepo,
      logger,
      prisma,
    }
  }

  function esitoOk(progressivo: number) {
    return {
      errore: false,
      transazione_id: `tx-${progressivo}`,
      esito: {
        progressivo,
        numero_fir: `FIR${progressivo}`,
        qr_code_bytes: 'YmFzZTY0',
        num_iscr_sito: 'OP1234ABC123456-RM1234',
        data_richiesta: '2026-09-11T10:00:00Z',
        codice_blocco: 'BLK-A',
      },
    }
  }

  it('vidima quantità richieste, una alla volta, e le persiste come DISPONIBILI', async () => {
    const { useCase, vidimazioneClient, scortaRepo } = build()
    vidimazioneClient.vidimaFir
      .mockResolvedValueOnce({ transazioneId: 'tx-1' })
      .mockResolvedValueOnce({ transazioneId: 'tx-2' })
      .mockResolvedValueOnce({ transazioneId: 'tx-3' })
    vidimazioneClient.attendiEsitoVidimazione
      .mockResolvedValueOnce(esitoOk(1))
      .mockResolvedValueOnce(esitoOk(2))
      .mockResolvedValueOnce(esitoOk(3))

    const risultato = await useCase.execute(TENANT, 'BLK-A', 3)

    expect(vidimazioneClient.vidimaFir).toHaveBeenCalledTimes(3)
    expect(scortaRepo.inserisciDisponibile).toHaveBeenCalledTimes(3)
    expect(scortaRepo.inserisciDisponibile).toHaveBeenNthCalledWith(1, TENANT, {
      numIscrSito: 'OP1234ABC123456-RM1234',
      codiceBlocco: 'BLK-A',
      progressivo: 1,
      numeroFir: 'FIR1',
      qrCodeBytes: 'YmFzZTY0',
      dataVidimazione: new Date('2026-09-11T10:00:00Z'),
    })
    expect(risultato).toEqual({ richiesti: 3, riusciti: 3, falliti: 0 })
  })

  it('un fallimento su un numero non interrompe gli altri (isolamento per numero)', async () => {
    const { useCase, vidimazioneClient, scortaRepo } = build()
    vidimazioneClient.vidimaFir
      .mockResolvedValueOnce({ transazioneId: 'tx-1' })
      .mockRejectedValueOnce(new Error('RENTRI non raggiungibile'))
      .mockResolvedValueOnce({ transazioneId: 'tx-3' })
    vidimazioneClient.attendiEsitoVidimazione
      .mockResolvedValueOnce(esitoOk(1))
      .mockResolvedValueOnce(esitoOk(3))

    const risultato = await useCase.execute(TENANT, 'BLK-A', 3)

    expect(scortaRepo.inserisciDisponibile).toHaveBeenCalledTimes(2)
    expect(risultato).toEqual({ richiesti: 3, riusciti: 2, falliti: 1 })
  })

  it('esito con errore=true non viene persistito come disponibile', async () => {
    const { useCase, vidimazioneClient, scortaRepo } = build()
    vidimazioneClient.vidimaFir.mockResolvedValue({ transazioneId: 'tx-1' })
    vidimazioneClient.attendiEsitoVidimazione.mockResolvedValue({
      errore: true,
      transazione_id: 'tx-1',
      esito: null,
    })

    const risultato = await useCase.execute(TENANT, 'BLK-A', 1)

    expect(scortaRepo.inserisciDisponibile).not.toHaveBeenCalled()
    expect(risultato).toEqual({ richiesti: 1, riusciti: 0, falliti: 1 })
  })

  it('rifiuta con 404 un codiceBlocco inesistente presso l’ente, PRIMA di scrivere (fail-closed)', async () => {
    const { useCase, vidimazioneClient, scortaRepo } = build({ blocchiEsistenti: [] })

    await expect(useCase.execute(TENANT, 'BLK-INESISTENTE', 3)).rejects.toThrow(NotFoundException)

    expect(vidimazioneClient.vidimaFir).not.toHaveBeenCalled()
    expect(scortaRepo.inserisciDisponibile).not.toHaveBeenCalled()
  })

  it('verifica l’esistenza del blocco presso l’ente prima di avviare la vidimazione', async () => {
    const { useCase, vidimazioneClient } = build({ blocchiEsistenti: [{ codice_blocco: 'BLK-A' }] })
    vidimazioneClient.vidimaFir.mockResolvedValue({ transazioneId: 'tx-1' })
    vidimazioneClient.attendiEsitoVidimazione.mockResolvedValue(esitoOk(1))

    await useCase.execute(TENANT, 'BLK-A', 1)

    expect(vidimazioneClient.elencaBlocchi).toHaveBeenCalledWith(
      'RSSMRA80A01H501U',
      { codiceBlocco: 'BLK-A', ancheDisattivi: true },
      TENANT
    )
  })

  describe('verificaBlocco (validazione preventiva usata dal controller, PRIMA del 202)', () => {
    it('rifiuta con 404 un codiceBlocco inesistente presso l’ente', async () => {
      const { useCase } = build({ blocchiEsistenti: [] })

      await expect(useCase.verificaBlocco(TENANT, 'BLK-INESISTENTE')).rejects.toThrow(
        NotFoundException
      )
    })

    it('risolve senza errori se il blocco esiste presso l’ente', async () => {
      const { useCase } = build({ blocchiEsistenti: [{ codice_blocco: 'BLK-A' }] })

      await expect(useCase.verificaBlocco(TENANT, 'BLK-A')).resolves.toBeUndefined()
    })

    it('un ente irraggiungibile (errore di comunicazione) è TRANSITORIO: non rifiuta la richiesta, si rimanda la verifica al ciclo di vidimazione', async () => {
      const { useCase, vidimazioneClient, logger } = build()
      vidimazioneClient.elencaBlocchi.mockRejectedValue(new Error('RENTRI non raggiungibile'))

      await expect(useCase.verificaBlocco(TENANT, 'BLK-A')).resolves.toBeUndefined()

      expect(logger.warn).toHaveBeenCalled()
    })
  })

  describe('execute: un ente irraggiungibile durante la verifica preventiva non deve azzerare il lotto in silenzio', () => {
    it('se elencaBlocchi fallisce per un errore di comunicazione, si procede comunque al ciclo di vidimazione (che isola per-numero, come prima di R6)', async () => {
      const { useCase, vidimazioneClient, scortaRepo, logger } = build()
      vidimazioneClient.elencaBlocchi.mockRejectedValue(new Error('RENTRI non raggiungibile'))
      vidimazioneClient.vidimaFir.mockResolvedValue({ transazioneId: 'tx-1' })
      vidimazioneClient.attendiEsitoVidimazione.mockResolvedValue(esitoOk(1))

      const risultato = await useCase.execute(TENANT, 'BLK-A', 1)

      expect(risultato).toEqual({ richiesti: 1, riusciti: 1, falliti: 0 })
      expect(scortaRepo.inserisciDisponibile).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalled()
    })
  })
})
