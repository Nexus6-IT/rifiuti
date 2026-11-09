import { RentriTrasmissioniSospeseJob } from './rentri-trasmissioni-sospese.job'
import {
  ETA_MASSIMA_PENDING_RENTRI_MS,
  SOGLIA_STALLO_RENTRI_MS,
} from '../../application/rentri/sync-fir-to-rentri.use-case'

describe('RentriTrasmissioniSospeseJob', () => {
  const logger: any = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }
  let firRepo: { elencaTrasmissioniRentriSospese: jest.Mock }
  let queue: { addSyncJob: jest.Mock; getJobState: jest.Mock }
  let modalita: { getForTenant: jest.Mock }
  let moduli: { tenantConModulo: jest.Mock }
  let job: RentriTrasmissioniSospeseJob

  beforeEach(() => {
    jest.clearAllMocks()
    firRepo = { elencaTrasmissioniRentriSospese: jest.fn() }
    queue = {
      addSyncJob: jest.fn().mockResolvedValue('id'),
      getJobState: jest.fn().mockResolvedValue(null),
    }
    modalita = {
      getForTenant: jest
        .fn()
        .mockResolvedValue({ modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true }),
    }
    moduli = {
      tenantConModulo: jest.fn(async (ids: readonly string[]) => new Set(ids)),
    }
    job = new RentriTrasmissioniSospeseJob(
      firRepo as any,
      queue as any,
      logger,
      modalita as any,
      moduli as any
    )
  })

  it('trasmissioni sospese: FIR di azienda senza certificato accodato comunque (lo chiude lo use case)', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f-senza', tenantId: 't-senza' },
    ])

    await job.riprendi()

    // Il job non controlla il certificato: saltare il FIR lo lascerebbe SYNCING per sempre
    // e, in testa all'elenco, affamerebbe le altre aziende. Lo chiude il use case.
    expect(queue.addSyncJob).toHaveBeenCalledWith(expect.objectContaining({ firId: 'f-senza' }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('trasmissioni sospese: FIR PENDING in AUTOMATICA senza job e senza avvio da oltre la soglia → accodato con sync-<id>', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f-pending', tenantId: 't-auto', stato: 'PENDING' },
    ])

    await job.riprendi()

    // Il jobId deterministico `sync-<firId>` lo costruisce la queue: un FIR gia' in coda non si duplica.
    expect(queue.addSyncJob).toHaveBeenCalledWith({
      firId: 'f-pending',
      tenantId: 't-auto',
      priority: 'low',
      richiedeConferma: false,
    })
  })

  it('trasmissioni sospese: FIR PENDING in MANUALE → non accodato', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f-manuale', tenantId: 't-man', stato: 'PENDING' },
      { firId: 'f-sync', tenantId: 't-man', stato: 'SYNCING' },
    ])
    modalita.getForTenant.mockResolvedValue({
      modalitaLegame: 'MANUALE',
      certificatoConfigurato: false,
    })

    await job.riprendi()

    expect(queue.addSyncJob).toHaveBeenCalledTimes(1)
    expect(queue.addSyncJob).toHaveBeenCalledWith(expect.objectContaining({ firId: 'f-sync' }))
  })

  it('FIR PENDING con job sync-<id> in failed → non riaccodato; senza job → accodato; SYNCING invariato', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f-rotto', tenantId: 't1', stato: 'PENDING' },
      { firId: 'f-nuovo', tenantId: 't1', stato: 'PENDING' },
      { firId: 'f-sync', tenantId: 't1', stato: 'SYNCING' },
    ])
    queue.getJobState.mockImplementation(async (jobId: string) =>
      jobId === 'sync-f-rotto' || jobId === 'sync-f-sync' ? 'failed' : null
    )

    await job.riprendi()

    expect(queue.addSyncJob).toHaveBeenCalledTimes(2)
    expect(queue.addSyncJob).not.toHaveBeenCalledWith(expect.objectContaining({ firId: 'f-rotto' }))
    expect(queue.addSyncJob).toHaveBeenCalledWith(expect.objectContaining({ firId: 'f-nuovo' }))
    // I SYNCING si riprendono come prima, anche con un job fallito (non si guarda lo stato)
    expect(queue.addSyncJob).toHaveBeenCalledWith(expect.objectContaining({ firId: 'f-sync' }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('accoda i FIR sospesi con priorità low', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't1' },
      { firId: 'f2', tenantId: 't2' },
    ])
    const prima = Date.now()

    await job.riprendi()

    const [soglia, limite, pendingDopo] = firRepo.elencaTrasmissioniRentriSospese.mock.calls[0]
    expect(limite).toBe(100)
    expect(Math.abs(pendingDopo.getTime() - (prima - ETA_MASSIMA_PENDING_RENTRI_MS))).toBeLessThan(
      5000
    )
    expect(Math.abs(soglia.getTime() - (prima - SOGLIA_STALLO_RENTRI_MS))).toBeLessThan(5000)
    expect(queue.addSyncJob).toHaveBeenCalledWith({
      firId: 'f1',
      tenantId: 't1',
      priority: 'low',
      richiedeConferma: false,
    })
    expect(queue.addSyncJob).toHaveBeenCalledWith({
      firId: 'f2',
      tenantId: 't2',
      priority: 'low',
      richiedeConferma: false,
    })
  })

  it('tenant IBRIDA: la ripresa chiede la conferma del legame, AUTOMATICA no', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f-ibrida', tenantId: 't-ibrida' },
      { firId: 'f-auto', tenantId: 't-auto' },
      { firId: 'f-ibrida-2', tenantId: 't-ibrida' },
    ])
    modalita.getForTenant.mockImplementation(async (tenantId: string) => ({
      modalitaLegame: tenantId === 't-ibrida' ? 'IBRIDA' : 'AUTOMATICA',
      certificatoConfigurato: true,
    }))

    await job.riprendi()

    expect(queue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ firId: 'f-ibrida', richiedeConferma: true })
    )
    expect(queue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ firId: 'f-ibrida-2', richiedeConferma: true })
    )
    expect(queue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ firId: 'f-auto', richiedeConferma: false })
    )
    // Una lettura della modalità per tenant, non per FIR.
    expect(modalita.getForTenant).toHaveBeenCalledTimes(2)
  })

  it('modalità non leggibile: quel FIR non si accoda, gli altri sì', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't1' },
      { firId: 'f2', tenantId: 't2' },
    ])
    modalita.getForTenant.mockImplementation(async (tenantId: string) => {
      if (tenantId === 't1') throw new Error('db')
      return { modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true }
    })

    await job.riprendi()

    expect(queue.addSyncJob).toHaveBeenCalledTimes(1)
    expect(queue.addSyncJob).toHaveBeenCalledWith(expect.objectContaining({ firId: 'f2' }))
    expect(logger.error).toHaveBeenCalled()
  })

  it('un errore di accodamento su un FIR non ferma gli altri', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't1' },
      { firId: 'f2', tenantId: 't2' },
    ])
    queue.addSyncJob.mockRejectedValueOnce(new Error('redis giù')).mockResolvedValueOnce('id')

    await expect(job.riprendi()).resolves.toBeUndefined()

    expect(queue.addSyncJob).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalled()
  })

  it('un errore nell’elenco non lancia', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockRejectedValue(new Error('db'))

    await expect(job.riprendi()).resolves.toBeUndefined()
    expect(queue.addSyncJob).not.toHaveBeenCalled()
  })

  it('moduli: i FIR delle aziende senza il modulo rentri non si riaccodano, UNA query sui moduli', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't1', stato: 'SYNCING' },
      { firId: 'f2', tenantId: 't-no', stato: 'SYNCING' },
      { firId: 'f3', tenantId: 't1', stato: 'SYNCING' },
      { firId: 'f4', tenantId: 't-no', stato: 'PENDING' },
    ])
    moduli.tenantConModulo.mockResolvedValue(new Set(['t1']))

    await job.riprendi()

    expect(moduli.tenantConModulo).toHaveBeenCalledTimes(1)
    expect(moduli.tenantConModulo).toHaveBeenCalledWith(['t1', 't-no'], 'rentri')
    expect(queue.addSyncJob).toHaveBeenCalledTimes(2)
    expect(queue.addSyncJob).not.toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-no' }))
    expect(modalita.getForTenant).not.toHaveBeenCalledWith('t-no')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('moduli: nessun FIR sospeso, nessuna query sui moduli; nessuna azienda col modulo, nessun errore', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([])
    await job.riprendi()
    expect(moduli.tenantConModulo).not.toHaveBeenCalled()

    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't-no', stato: 'SYNCING' },
    ])
    moduli.tenantConModulo.mockResolvedValue(new Set())
    await job.riprendi()
    expect(queue.addSyncJob).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })
})
