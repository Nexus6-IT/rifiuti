import * as Sentry from '@sentry/node'
import {
  RentriCodificheSyncService,
  AllineamentoRentriGiaInCorsoError,
} from './rentri-codifiche-sync.service'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

describe('RentriCodificheSyncService', () => {
  let cerSync: { allinea: jest.Mock }
  let codificheSempliciSync: { allinea: jest.Mock }
  let territorialiSync: { allinea: jest.Mock }
  let logger: any
  let service: RentriCodificheSyncService

  beforeEach(() => {
    jest.clearAllMocks()
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

  describe('ultimo esito (R4 Task 7 Step 2: diagnostica)', () => {
    it('è null prima del primo ciclo concluso', () => {
      expect(service.ottieniUltimoEsito()).toBeNull()
    })

    it('registra quando + i tre esiti dopo un ciclo completato con successo', async () => {
      const esitoCer = { nuovi: 1, aggiornati: 2, rimossi: 0 }
      const esitoSemplici = [{ tabella: 'stati-fisici', nuovi: 1, aggiornati: 0, rimossi: 0 }]
      const esitoTerritoriali = [{ tabella: 'comuni', nuovi: 0, aggiornati: 5, rimossi: 0 }]
      cerSync.allinea.mockResolvedValue(esitoCer)
      codificheSempliciSync.allinea.mockResolvedValue(esitoSemplici)
      territorialiSync.allinea.mockResolvedValue(esitoTerritoriali)

      const prima = Date.now()
      await service.allineaTutto()
      const dopo = Date.now()

      const esito = service.ottieniUltimoEsito()
      expect(esito).not.toBeNull()
      expect(esito!.cer).toEqual(esitoCer)
      expect(esito!.codificheSemplici).toEqual(esitoSemplici)
      expect(esito!.territoriali).toEqual(esitoTerritoriali)
      expect(esito!.quando.getTime()).toBeGreaterThanOrEqual(prima)
      expect(esito!.quando.getTime()).toBeLessThanOrEqual(dopo)
    })

    it('un passo fallito registra null per quel passo, non blocca la registrazione degli altri', async () => {
      cerSync.allinea.mockRejectedValue(new Error('RENTRI non raggiungibile'))
      codificheSempliciSync.allinea.mockResolvedValue([
        { tabella: 'stati-fisici', nuovi: 1, aggiornati: 0, rimossi: 0 },
      ])

      await service.allineaTutto()

      const esito = service.ottieniUltimoEsito()
      expect(esito!.cer).toBeNull()
      expect(esito!.codificheSemplici).toEqual([
        { tabella: 'stati-fisici', nuovi: 1, aggiornati: 0, rimossi: 0 },
      ])
    })

    it('un ciclo rigettato dal lock di concorrenza NON sovrascrive l’esito precedente', async () => {
      cerSync.allinea.mockResolvedValue({ nuovi: 0, aggiornati: 0, rimossi: 0 })
      await service.allineaTutto()
      const primoEsito = service.ottieniUltimoEsito()

      function deferred<T>() {
        let resolve!: (value: T) => void
        const promise = new Promise<T>(res => {
          resolve = res
        })
        return { promise, resolve }
      }
      const bloccato = deferred<{ nuovi: number; aggiornati: number; rimossi: number }>()
      cerSync.allinea.mockImplementation(() => bloccato.promise)

      const inVolo = service.allineaTutto()
      await Promise.resolve()
      await expect(service.allineaTutto()).rejects.toThrow(AllineamentoRentriGiaInCorsoError)

      expect(service.ottieniUltimoEsito()).toEqual(primoEsito)

      bloccato.resolve({ nuovi: 0, aggiornati: 0, rimossi: 0 })
      await inVolo
    })
  })

  describe('lock di concorrenza in memoria', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    it("Test A: una seconda allineaTutto() mentre la prima è in volo rigetta con AllineamentoRentriGiaInCorsoError senza chiamare l'ente", async () => {
      const primoCiclo = deferred<{ nuovi: number; aggiornati: number; rimossi: number }>()
      cerSync.allinea.mockImplementation(() => primoCiclo.promise)

      const chiamataUno = service.allineaTutto()

      await Promise.resolve() // lascia partire il primo giro fino all'attesa di cerSync.allinea

      await expect(service.allineaTutto()).rejects.toThrow(AllineamentoRentriGiaInCorsoError)
      expect(cerSync.allinea).toHaveBeenCalledTimes(1)

      primoCiclo.resolve({ nuovi: 0, aggiornati: 0, rimossi: 0 })
      await expect(chiamataUno).resolves.toBeUndefined()
    })

    it('Test B: dopo che una chiamata è terminata (anche con un passo fallito) il lock si rilascia e la chiamata successiva viene eseguita normalmente', async () => {
      cerSync.allinea.mockRejectedValueOnce(new Error('RENTRI non raggiungibile'))

      await service.allineaTutto()

      cerSync.allinea.mockResolvedValue({ nuovi: 0, aggiornati: 0, rimossi: 0 })
      codificheSempliciSync.allinea.mockClear()
      territorialiSync.allinea.mockClear()

      await service.allineaTutto()

      expect(cerSync.allinea).toHaveBeenCalledTimes(2)
      expect(codificheSempliciSync.allinea).toHaveBeenCalledTimes(1)
      expect(territorialiSync.allinea).toHaveBeenCalledTimes(1)
    })

    it("Test C: se allineamentoSchedulato() scatta mentre un'altra allineaTutto() è in volo, non lancia e logga un warning di ciclo saltato", async () => {
      const primoCiclo = deferred<{ nuovi: number; aggiornati: number; rimossi: number }>()
      cerSync.allinea.mockImplementation(() => primoCiclo.promise)

      const chiamataManuale = service.allineaTutto()

      await Promise.resolve()

      await expect(service.allineamentoSchedulato()).resolves.toBeUndefined()
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('già in corso'))

      primoCiclo.resolve({ nuovi: 0, aggiornati: 0, rimossi: 0 })
      await chiamataManuale
    })

    it('allineamentoSchedulato non rilancia un errore generico: lo logga e lo segnala', async () => {
      jest.spyOn(service, 'allineaTutto').mockRejectedValue(new Error('rete'))

      await expect(service.allineamentoSchedulato()).resolves.toBeUndefined()

      expect(logger.error).toHaveBeenCalled()
      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { job: 'allineamentoSchedulato' },
      })
    })
  })
})
