import { AvviaVidimazioneScortaUseCase } from './avvia-vidimazione-scorta.use-case'

describe('AvviaVidimazioneScortaUseCase', () => {
  const TENANT = 'tenant-1'

  function build() {
    const vidimazioneClient = {
      vidimaFir: jest.fn(),
      attendiEsitoVidimazione: jest.fn(),
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
    return {
      useCase: new AvviaVidimazioneScortaUseCase(
        vidimazioneClient as any,
        scortaRepo as any,
        logger as any
      ),
      vidimazioneClient,
      scortaRepo,
      logger,
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
})
