import { DelayedError, Job, UnrecoverableError } from 'bullmq'
import {
  ElaborazioneAttivaError,
  ElaborazioneNonTrovataError,
} from '../../../application/fatturazione/anteprima'
import { ATTESA_RINVIO_MS, FatturazioneJobProcessor, RINVII_MASSIMI } from './fatturazione.job'

const mockEsegui = jest.fn()
const mockFallita = jest.fn()
jest.mock('../../../application/fatturazione/anteprima', () => ({
  ...jest.requireActual('../../../application/fatturazione/anteprima'),
  eseguiAnteprima: (...a: unknown[]) => mockEsegui(...a),
  segnaFallita: (...a: unknown[]) => mockFallita(...a),
}))
jest.mock('../../../core/monitoring/segnala-errore-job', () => ({ segnalaErroreJob: jest.fn() }))

function creaJob(
  data: Record<string, unknown>,
  o: { attemptsMade?: number; attempts?: number } = {}
) {
  const job = {
    id: 'anteprima-e1-v1',
    data: { ...data },
    attemptsMade: o.attemptsMade ?? 0,
    opts: { attempts: o.attempts ?? 2 },
    updateData: jest.fn(async (nuovi: Record<string, unknown>) => {
      job.data = nuovi
    }),
    moveToDelayed: jest.fn(),
  }
  return job
}

const DATI = { tenantId: 't1', elaborazioneId: 'e1', tipo: 'anteprima', versione: 1 }
const prisma = {} as never

describe('FatturazioneJobProcessor', () => {
  let processor: FatturazioneJobProcessor
  beforeEach(() => {
    mockEsegui.mockReset()
    mockFallita.mockReset()
    processor = new FatturazioneJobProcessor(prisma)
  })
  const esegui = (job: ReturnType<typeof creaJob>) =>
    processor.process(job as unknown as Job<never>, 'token')

  it('anteprima riuscita: nessuna scrittura di errore', async () => {
    mockEsegui.mockResolvedValue(undefined)
    await esegui(creaJob(DATI))
    expect(mockEsegui).toHaveBeenCalledWith(prisma, 't1', 'e1', 1)
    expect(mockFallita).not.toHaveBeenCalled()
  })

  it('un altro job in corso (23505): rimesso in attesa di 30 secondi, rinvii contati', async () => {
    mockEsegui.mockRejectedValue(new ElaborazioneAttivaError())
    const job = creaJob({ ...DATI, rinvii: 3 })
    const prima = Date.now()
    await expect(esegui(job)).rejects.toBeInstanceOf(DelayedError)
    expect(job.data.rinvii).toBe(4)
    const [quando, token] = job.moveToDelayed.mock.calls[0]
    expect(token).toBe('token')
    expect(quando).toBeGreaterThanOrEqual(prima + ATTESA_RINVIO_MS)
    expect(quando).toBeLessThan(prima + ATTESA_RINVIO_MS + 5_000)
    expect(mockFallita).not.toHaveBeenCalled()
  })

  it('all’undicesimo giro (dieci rinvii gia’ fatti): FALLITA «Un’altra elaborazione era in corso»', async () => {
    mockEsegui.mockRejectedValue(new ElaborazioneAttivaError())
    const job = creaJob({ ...DATI, rinvii: RINVII_MASSIMI })
    await expect(esegui(job)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(mockFallita).toHaveBeenCalledWith(
      prisma,
      't1',
      'e1',
      "Un'altra elaborazione era in corso",
      1
    )
  })

  it('un errore al primo tentativo: nessuna FALLITA, il job viene ritentato', async () => {
    mockEsegui.mockRejectedValue(new Error('guasto'))
    await expect(esegui(creaJob(DATI, { attemptsMade: 0, attempts: 2 }))).rejects.toThrow('guasto')
    expect(mockFallita).not.toHaveBeenCalled()
  })

  it('un errore all’ultimo tentativo: FALLITA con un messaggio fisso, senza il testo dell’errore', async () => {
    mockEsegui.mockRejectedValue(new Error('dato personale: Mario Rossi'))
    await expect(esegui(creaJob(DATI, { attemptsMade: 1, attempts: 2 }))).rejects.toThrow()
    expect(mockFallita).toHaveBeenCalledTimes(1)
    const messaggio = mockFallita.mock.calls[0][3] as string
    expect(messaggio).not.toContain('Mario')
    expect(messaggio.length).toBeLessThanOrEqual(200)
  })

  it('elaborazione non trovata (altra azienda): fallimento definitivo, nessuna FALLITA', async () => {
    mockEsegui.mockRejectedValue(new ElaborazioneNonTrovataError())
    await expect(esegui(creaJob(DATI))).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mockFallita).not.toHaveBeenCalled()
  })

  it('un tipo che questo task non gestisce (la definitiva e’ del Task 19): fallimento definitivo', async () => {
    await expect(esegui(creaJob({ ...DATI, tipo: 'definitiva' }))).rejects.toBeInstanceOf(
      UnrecoverableError
    )
    expect(mockEsegui).not.toHaveBeenCalled()
  })
})
