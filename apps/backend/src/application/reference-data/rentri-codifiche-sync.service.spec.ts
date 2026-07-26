import { RentriCodificheSyncService } from './rentri-codifiche-sync.service'

describe('RentriCodificheSyncService', () => {
  let cerSync: { allinea: jest.Mock }
  let codificheSempliciSync: { allinea: jest.Mock }
  let territorialiSync: { allinea: jest.Mock }
  let logger: any
  let service: RentriCodificheSyncService

  beforeEach(() => {
    cerSync = { allinea: jest.fn().mockResolvedValue({ nuovi: 0, aggiornati: 0, rimossi: 0 }) }
    codificheSempliciSync = { allinea: jest.fn().mockResolvedValue([]) }
    territorialiSync = { allinea: jest.fn().mockResolvedValue([]) }
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    service = new RentriCodificheSyncService(
      cerSync as any,
      codificheSempliciSync as any,
      territorialiSync as any,
      logger
    )
  })

  it('chiama i tre sotto-servizi in sequenza: CER, poi codifiche semplici, poi territoriali', async () => {
    const ordine: string[] = []
    cerSync.allinea.mockImplementation(async () => {
      ordine.push('cer')
      return { nuovi: 0, aggiornati: 0, rimossi: 0 }
    })
    codificheSempliciSync.allinea.mockImplementation(async () => {
      ordine.push('semplici')
      return []
    })
    territorialiSync.allinea.mockImplementation(async () => {
      ordine.push('territoriali')
      return []
    })

    await service.allineaTutto('tenant-1')

    expect(ordine).toEqual(['cer', 'semplici', 'territoriali'])
    expect(cerSync.allinea).toHaveBeenCalledWith('tenant-1')
    expect(codificheSempliciSync.allinea).toHaveBeenCalledWith('tenant-1')
    expect(territorialiSync.allinea).toHaveBeenCalledWith('tenant-1')
  })

  it('un passo che fallisce non impedisce gli altri passi (try/catch per passo)', async () => {
    cerSync.allinea.mockRejectedValue(new Error('RENTRI non raggiungibile'))

    await expect(service.allineaTutto()).resolves.toBeUndefined()

    expect(codificheSempliciSync.allinea).toHaveBeenCalled()
    expect(territorialiSync.allinea).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CER'))
  })

  it('il cron schedulato esegue lo stesso ciclo completo', async () => {
    await service.allineamentoSchedulato()

    expect(cerSync.allinea).toHaveBeenCalled()
    expect(codificheSempliciSync.allinea).toHaveBeenCalled()
    expect(territorialiSync.allinea).toHaveBeenCalled()
  })
})
