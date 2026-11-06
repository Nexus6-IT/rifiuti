import { DelayedError, Job, UnrecoverableError } from 'bullmq'
import {
  ElaborazioneAttivaError,
  ElaborazioneNonTrovataError,
} from '../../../application/fatturazione/anteprima'
import { ATTESA_RINVIO_MS, FatturazioneJobProcessor, RINVII_MASSIMI } from './fatturazione.job'

const mockEsegui = jest.fn()
const mockFallita = jest.fn()
const mockDefinitiva = jest.fn()
const mockSegnala = jest.fn()
jest.mock('../../../application/fatturazione/definitiva', () => ({
  ...jest.requireActual('../../../application/fatturazione/definitiva'),
  eseguiDefinitiva: (...a: unknown[]) => mockDefinitiva(...a),
}))
jest.mock('../../../application/fatturazione/anteprima', () => ({
  ...jest.requireActual('../../../application/fatturazione/anteprima'),
  eseguiAnteprima: (...a: unknown[]) => mockEsegui(...a),
  segnaFallita: (...a: unknown[]) => mockFallita(...a),
}))
jest.mock('../../../core/monitoring/segnala-errore-job', () => ({
  segnalaErroreJob: (...a: unknown[]) => mockSegnala(...a),
}))

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

const DATI = {
  tenantId: 't1',
  elaborazioneId: '00000000-0000-4000-8000-000000000001',
  tipo: 'anteprima',
  versione: 1,
}
const prisma = {} as never

describe('FatturazioneJobProcessor', () => {
  let processor: FatturazioneJobProcessor
  beforeEach(() => {
    mockEsegui.mockReset()
    mockFallita.mockReset()
    mockDefinitiva.mockReset()
    mockSegnala.mockReset()
    processor = new FatturazioneJobProcessor(prisma)
  })
  const esegui = (job: ReturnType<typeof creaJob>) =>
    processor.process(job as unknown as Job<never>, 'token')

  it('anteprima riuscita: nessuna scrittura di errore', async () => {
    mockEsegui.mockResolvedValue(undefined)
    await esegui(creaJob(DATI))
    expect(mockEsegui).toHaveBeenCalledWith(prisma, 't1', '00000000-0000-4000-8000-000000000001', 1)
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
      '00000000-0000-4000-8000-000000000001',
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

  it('elaborazioneId che non e’ un UUID: fallimento definitivo prima di ogni query', async () => {
    await expect(
      esegui(creaJob({ ...DATI, elaborazioneId: 'non-un-uuid' }))
    ).rejects.toBeInstanceOf(UnrecoverableError)
    expect(mockEsegui).not.toHaveBeenCalled()
    expect(mockFallita).not.toHaveBeenCalled()
  })

  describe('definitiva (Task 19)', () => {
    const UTENTE = '00000000-0000-4000-8000-0000000000aa'
    const dati = { ...DATI, tipo: 'definitiva', versione: 2, utenteId: UTENTE }
    const job = (o: { attemptsMade?: number } = {}) => ({
      ...creaJob(dati, { attempts: 1, ...o }),
      id: 'definitiva-00000000-0000-4000-8000-000000000001-v2',
    })

    it('esegue la definitiva col contesto del tenant, la versione e il job_id del job', async () => {
      mockDefinitiva.mockResolvedValue({ esito: 'DEFINITIVA', documenti: 1, numeri: [] })
      await esegui(job() as never)
      expect(mockDefinitiva).toHaveBeenCalledWith(
        prisma,
        't1',
        '00000000-0000-4000-8000-000000000001',
        UTENTE,
        { versione: 2, jobId: 'definitiva-00000000-0000-4000-8000-000000000001-v2' }
      )
      expect(mockEsegui).not.toHaveBeenCalled()
      expect(mockSegnala).not.toHaveBeenCalled()
    })

    it('un esito negativo (ANTEPRIMA_SUPERATA) non e un errore del job: e gia nella colonna esito', async () => {
      mockDefinitiva.mockResolvedValue({
        esito: 'ANTEPRIMA_SUPERATA',
        differenze: { nuovi: 1, cambiati: 0, fatturatiDaAltri: 0 },
      })
      await expect(esegui(job() as never)).resolves.toBeUndefined()
      expect(mockSegnala).not.toHaveBeenCalled()
    })

    it('un errore tecnico: segnalato, il job fallisce senza un secondo tentativo (attempts 1)', async () => {
      mockDefinitiva.mockRejectedValue(new Error('guasto'))
      await expect(esegui(job() as never)).rejects.toThrow('guasto')
      expect(mockSegnala).toHaveBeenCalledWith('fatturazione-definitiva', expect.any(Error), {
        tenantId: 't1',
      })
      // Il ritorno a ANTEPRIMA_PRONTA lo fa `eseguiDefinitiva`, non il job: niente FALLITA.
      expect(mockFallita).not.toHaveBeenCalled()
    })

    it('elaborazione non trovata (altra azienda): fallimento definitivo, niente segnalazione', async () => {
      mockDefinitiva.mockRejectedValue(new ElaborazioneNonTrovataError())
      await expect(esegui(job() as never)).rejects.toBeInstanceOf(UnrecoverableError)
      expect(mockSegnala).not.toHaveBeenCalled()
    })

    it('senza azienda, con elaborazioneId o utenteId non validi: fallimento definitivo prima di ogni query', async () => {
      for (const sbagliati of [
        { tenantId: '' },
        { elaborazioneId: 'non-un-uuid' },
        { utenteId: 'non-un-uuid' },
      ]) {
        await expect(
          esegui({ ...job(), data: { ...dati, ...sbagliati } } as never)
        ).rejects.toBeInstanceOf(UnrecoverableError)
      }
      expect(mockDefinitiva).not.toHaveBeenCalled()
    })

    it('un job vecchio senza utenteId parte lo stesso (definita_da resta nullo)', async () => {
      mockDefinitiva.mockResolvedValue({ esito: 'NON_ESEGUITA' })
      const { utenteId: _scartato, ...senza } = dati
      await esegui({ ...job(), data: senza } as never)
      expect(mockDefinitiva.mock.calls[0][3]).toBeNull()
    })
  })

  it('un tipo sconosciuto: fallimento definitivo', async () => {
    await expect(esegui(creaJob({ ...DATI, tipo: 'altro' }))).rejects.toBeInstanceOf(
      UnrecoverableError
    )
    expect(mockEsegui).not.toHaveBeenCalled()
    expect(mockDefinitiva).not.toHaveBeenCalled()
  })
})
