/**
 * Test unitari del job di manutenzione della fatturazione (fase 4.4b1, Task 22): cadenze dei cron,
 * controllo all'avvio, elenco dei tenant dal client di sistema, job vivi dalla coda, errore di
 * Redis che ferma il giro degli orfani. L'effetto sul database lo prova la spec Postgres.
 */
import { CronExpression } from '@nestjs/schedule'
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'
import { FatturazioneManutenzioneJob } from './fatturazione-manutenzione.job'

const mockSegnala = jest.fn()
jest.mock('../../core/monitoring/segnala-errore-job', () => ({
  segnalaErroreJob: (...a: unknown[]) => mockSegnala(...a),
}))
const mockPulisci = jest.fn()
const mockRecupera = jest.fn()
jest.mock('../../application/fatturazione/manutenzione-fatturazione', () => ({
  ...jest.requireActual('../../application/fatturazione/manutenzione-fatturazione'),
  pulisciBozzeTenant: (...a: unknown[]) => mockPulisci(...a),
  recuperaOrfaniTenant: (...a: unknown[]) => mockRecupera(...a),
}))

const opzioniCron = (metodo: keyof FatturazioneManutenzioneJob) =>
  Reflect.getMetadata(
    SCHEDULE_CRON_OPTIONS,
    FatturazioneManutenzioneJob.prototype[metodo] as object
  )

describe('FatturazioneManutenzioneJob', () => {
  let sistema: { tenant: { findMany: jest.Mock } }
  let prisma: { $transaction: jest.Mock }
  let coda: { getJobs: jest.Mock }
  let job: FatturazioneManutenzioneJob

  beforeEach(() => {
    mockSegnala.mockReset()
    mockPulisci.mockReset().mockResolvedValue(0)
    mockRecupera.mockReset().mockResolvedValue(0)
    sistema = { tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]) } }
    prisma = { $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})) }
    coda = { getJobs: jest.fn().mockResolvedValue([{ id: 'j1' }, { id: 'j2' }, { id: undefined }]) }
    job = new FatturazioneManutenzioneJob(prisma as never, sistema as never, coda as never)
  })

  it('cron degli orfani ogni 10 minuti, pulizia delle bozze una volta al giorno', () => {
    expect(opzioniCron('eseguiRecuperoOrfani').cronTime).toBe(CronExpression.EVERY_10_MINUTES)
    const giornaliero = String(opzioniCron('eseguiPulizia').cronTime)
    expect(giornaliero).toBe(CronExpression.EVERY_DAY_AT_3AM)
  })

  it('i tenant vengono dal client di sistema, senza la piattaforma, solo attivi o in prova', async () => {
    await job.pulisciBozze()
    expect(sistema.tenant.findMany).toHaveBeenCalledWith({
      where: escludiPiattaforma({ subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } }),
      select: { id: true },
    })
  })

  it("gli orfani si controllano anche all'avvio del modulo", async () => {
    job.onModuleInit()
    await new Promise(r => setTimeout(r, 20))
    expect(mockRecupera).toHaveBeenCalledTimes(2)
  })

  it("l'avvio non fa cadere il modulo se Redis non risponde", async () => {
    coda.getJobs.mockRejectedValue(new Error("redis giu'"))
    expect(job.onModuleInit()).toBeUndefined()
    await new Promise(r => setTimeout(r, 20))
    expect(mockSegnala).toHaveBeenCalled()
  })

  it('passa agli orfani gli id dei job attivi, in attesa e ritardati, senza id vuoti', async () => {
    await job.recuperaOrfani()
    expect(coda.getJobs).toHaveBeenCalledWith(
      expect.arrayContaining(['active', 'waiting', 'delayed'])
    )
    const vivi = mockRecupera.mock.calls[0][2] as ReadonlySet<string>
    expect([...vivi].sort()).toEqual(['j1', 'j2'])
  })

  it('se la coda non risponde NON recupera nulla (senza elenco dei job vivi tutto sembrerebbe orfano)', async () => {
    coda.getJobs.mockRejectedValue(new Error("redis giu'"))
    await expect(job.recuperaOrfani()).rejects.toThrow('redis giu')
    expect(mockRecupera).not.toHaveBeenCalled()
  })

  it("l'handler @Cron non rilancia mai e segnala l'errore generale", async () => {
    coda.getJobs.mockRejectedValue(new Error("redis giu'"))
    await expect(job.eseguiRecuperoOrfani()).resolves.toBeUndefined()
    expect(mockSegnala).toHaveBeenCalledWith('eseguiRecuperoOrfani', expect.any(Error))
  })

  it("un errore su un tenant e' segnalato col tenantId e non ferma gli altri", async () => {
    mockPulisci.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(4)
    const esito = await job.pulisciBozze()
    expect(esito).toEqual({ tenantTotali: 2, tenantConErrore: 1, bozzeCancellate: 4 })
    expect(mockSegnala).toHaveBeenCalledWith('eseguiPulizia', expect.any(Error), {
      tenantId: 't1',
    })
  })

  it('onModuleInit si risolve subito anche se la coda non risponde mai (non blocca l\x27avvio)', async () => {
    coda.getJobs.mockReturnValue(new Promise(() => undefined))
    job.timeoutJobViviMs = 30
    expect(job.onModuleInit()).toBeUndefined()
    // Il giro in sottofondo scade e non recupera nulla; nessuna unhandled rejection.
    await new Promise(r => setTimeout(r, 80))
    expect(mockRecupera).not.toHaveBeenCalled()
    expect(mockSegnala).toHaveBeenCalledWith('eseguiRecuperoOrfani', expect.any(Error))
  })

  it('con il timeout dei job vivi scaduto il giro salta e rifiuta', async () => {
    coda.getJobs.mockReturnValue(new Promise(() => undefined))
    job.timeoutJobViviMs = 20
    await expect(job.recuperaOrfani()).rejects.toThrow(/timeout/i)
    expect(mockRecupera).not.toHaveBeenCalled()
  })
})
