import { Job, Queue, Worker } from 'bullmq'
import {
  ElaborazioneAttivaError,
  ElaborazioneNonTrovataError,
} from '../../../application/fatturazione/anteprima'
import {
  idJobFatturazione,
  type JobFatturazione,
} from '../../../application/fatturazione/elaborazioni.service'
import { FatturazioneJobProcessor } from './fatturazione.job'

/**
 * Coda `fatturazione` su un Redis reale (Q5, Q12): i job con l'id col trattino sono accettati, uno
 * fallito non impedisce di ripetere la richiesta con la versione dopo, e un job rinviato per
 * un'altra elaborazione attiva finisce davvero in `delayed` con `rinvii` aggiornato.
 *
 * Redis di test: un container usa e getta su una porta casuale, per esempio
 *   docker run -d --rm --name redis-t18 -p 127.0.0.1:0:6379 redis:7-alpine
 *   FATT_T18_REDIS_PORT=$(docker port redis-t18 6379/tcp | head -1 | sed 's/.*://')
 * poi `docker stop redis-t18`. Non toccare i Redis gia' attivi della macchina.
 */
const connection = {
  host: process.env.FATT_T18_REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.FATT_T18_REDIS_PORT ?? 0),
}

const mockEsegui = jest.fn()
jest.mock('../../../application/fatturazione/anteprima', () => ({
  ...jest.requireActual('../../../application/fatturazione/anteprima'),
  eseguiAnteprima: (...a: unknown[]) => mockEsegui(...a),
  segnaFallita: jest.fn().mockResolvedValue(undefined),
}))

const dati = (versione: number): JobFatturazione => ({
  tenantId: 't1',
  elaborazioneId: '00000000-0000-4000-8000-000000000001',
  tipo: 'anteprima',
  versione,
})

describe('coda fatturazione su Redis reale', () => {
  const nome = `fatturazione-t18-${process.pid}`
  let coda: Queue
  let worker: Worker | undefined

  beforeAll(async () => {
    expect(connection.port).toBeGreaterThan(0)
    coda = new Queue(nome, { connection })
    await coda.waitUntilReady()
  })
  beforeEach(async () => {
    // Nessun job avanzato dal test prima: il worker del test dopo non deve consumarlo.
    await coda.obliterate({ force: true })
  })
  afterEach(async () => {
    await worker?.close()
    worker = undefined
    mockEsegui.mockReset()
  })
  afterAll(async () => {
    await coda.obliterate({ force: true })
    await coda.close()
  })

  const aspetta = async (cond: () => Promise<boolean>) => {
    const scadenza = Date.now() + 15_000
    while (!(await cond())) {
      if (Date.now() > scadenza) throw new Error('condizione non raggiunta')
      await new Promise(r => setTimeout(r, 50))
    }
  }

  it('BullMQ 5.62 accetta l’id col trattino; un id con due punti non e’ un id sicuro', async () => {
    const id = idJobFatturazione({
      tipo: 'anteprima',
      elaborazioneId: '00000000-0000-4000-8000-000000000004',
      versione: 1,
    })
    await expect(coda.add('anteprima', dati(1), { jobId: id })).resolves.toBeDefined()
    await expect(coda.add('anteprima', dati(1), { jobId: 'anteprima:e1' })).rejects.toThrow()
  })

  it('un job fallito non impedisce di ripetere la richiesta: la versione dopo ha un id nuovo ed e’ eseguita (Q5)', async () => {
    const processor = new FatturazioneJobProcessor({} as never)
    mockEsegui.mockRejectedValueOnce(new Error('guasto')).mockResolvedValue(undefined)
    worker = new Worker(nome, (job: Job<JobFatturazione>, token) => processor.process(job, token), {
      connection,
    })
    const v1 = idJobFatturazione({
      tipo: 'anteprima',
      elaborazioneId: '00000000-0000-4000-8000-000000000005',
      versione: 1,
    })
    const v2 = idJobFatturazione({
      tipo: 'anteprima',
      elaborazioneId: '00000000-0000-4000-8000-000000000005',
      versione: 2,
    })
    await coda.add(
      'anteprima',
      { ...dati(1), elaborazioneId: '00000000-0000-4000-8000-000000000005' },
      { jobId: v1, attempts: 1 }
    )
    await aspetta(
      async () => (await coda.getJob(v1))?.getState().then(s => s === 'failed') ?? false
    )

    // Lo stesso id resterebbe ignorato finche' il fallito non scade: per questo la versione.
    await coda.add(
      'anteprima',
      { ...dati(1), elaborazioneId: '00000000-0000-4000-8000-000000000005' },
      { jobId: v1, attempts: 1 }
    )
    expect(await (await coda.getJob(v1))!.getState()).toBe('failed')
    await coda.add(
      'anteprima',
      { ...dati(2), elaborazioneId: '00000000-0000-4000-8000-000000000005' },
      { jobId: v2, attempts: 1 }
    )
    await aspetta(
      async () => (await coda.getJob(v2))?.getState().then(s => s === 'completed') ?? false
    )
    expect(mockEsegui).toHaveBeenCalledTimes(2)
  })

  it('un’altra elaborazione attiva: il job finisce in delayed con rinvii aggiornato (Q12)', async () => {
    const processor = new FatturazioneJobProcessor({} as never)
    mockEsegui.mockRejectedValue(new ElaborazioneAttivaError())
    worker = new Worker(nome, (job: Job<JobFatturazione>, token) => processor.process(job, token), {
      connection,
    })
    const id = idJobFatturazione({
      tipo: 'anteprima',
      elaborazioneId: '00000000-0000-4000-8000-000000000006',
      versione: 1,
    })
    await coda.add(
      'anteprima',
      { ...dati(1), elaborazioneId: '00000000-0000-4000-8000-000000000006' },
      { jobId: id, attempts: 2 }
    )
    await aspetta(
      async () => (await coda.getJob(id))?.getState().then(s => s === 'delayed') ?? false
    )
    const job = (await coda.getJob(id))!
    expect(job.data.rinvii).toBe(1)
    expect(job.delay).toBeGreaterThan(0)
    // Un rinvio non consuma un tentativo.
    expect(job.attemptsMade).toBe(0)
  })

  it('elaborazione non trovata: il job fallisce subito, senza secondo tentativo', async () => {
    const processor = new FatturazioneJobProcessor({} as never)
    mockEsegui.mockRejectedValue(new ElaborazioneNonTrovataError())
    worker = new Worker(nome, (job: Job<JobFatturazione>, token) => processor.process(job, token), {
      connection,
    })
    const id = idJobFatturazione({
      tipo: 'anteprima',
      elaborazioneId: '00000000-0000-4000-8000-000000000007',
      versione: 1,
    })
    await coda.add(
      'anteprima',
      { ...dati(1), elaborazioneId: '00000000-0000-4000-8000-000000000007' },
      { jobId: id, attempts: 3 }
    )
    await aspetta(
      async () => (await coda.getJob(id))?.getState().then(s => s === 'failed') ?? false
    )
    expect(mockEsegui).toHaveBeenCalledTimes(1)
  })
})
