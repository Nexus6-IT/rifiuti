import type { Queue } from 'bullmq'

import { CodeProbe, CODE_ATTESE } from './code.probe'

function codaFinta(params: {
  workers?: number
  counts?: Record<string, number>
  ultimoCompletatoMs?: number | null
  errore?: Error
}): Queue {
  const counts = params.counts ?? {}
  return {
    getWorkers: jest.fn().mockImplementation(async () => {
      if (params.errore) throw params.errore
      return new Array(params.workers ?? 0).fill({})
    }),
    getJobCounts: jest.fn().mockImplementation(async () => {
      if (params.errore) throw params.errore
      return counts
    }),
    getJobs: jest.fn().mockImplementation(async () => {
      if (params.errore) throw params.errore
      return params.ultimoCompletatoMs ? [{ finishedOn: params.ultimoCompletatoMs }] : []
    }),
  } as unknown as Queue
}

describe('CodeProbe', () => {
  const probe = new CodeProbe()

  it('restituisce una voce per ogni coda attesa', async () => {
    const voci = await probe.raccogli(new Map())

    expect(voci).toHaveLength(CODE_ATTESE.length)
    expect(voci.map(v => v.key)).toEqual(CODE_ATTESE.map(c => `coda.${c.nome}`))
  })

  it('dichiara error — con la causa — la coda senza consumatori, anche se vuota', async () => {
    const code = new Map<string, Queue>([
      [
        'rentri-sync',
        codaFinta({ workers: 0, counts: { waiting: 0, active: 0, delayed: 0, failed: 0 } }),
      ],
    ])

    const voce = (await probe.raccogli(code)).find(v => v.key === 'coda.rentri-sync')

    expect(voce?.state).toBe('error')
    expect(voce?.detail).toContain('Nessun consumatore connesso')
    expect(voce?.detail).toContain('0 in attesa')
  })

  it('e ok con un consumatore vivo e nessun fallito', async () => {
    const code = new Map<string, Queue>([
      [
        'rentri-sync',
        codaFinta({
          workers: 2,
          counts: { waiting: 3, active: 1, delayed: 0, failed: 0 },
          ultimoCompletatoMs: Date.now() - 45_000,
        }),
      ],
    ])

    const voce = (await probe.raccogli(code)).find(v => v.key === 'coda.rentri-sync')

    expect(voce?.state).toBe('ok')
    expect(voce?.detail).toContain('2 consumatori')
    expect(voce?.detail).toContain('ultimo completato 45 s fa')
    expect(voce?.since).not.toBeNull()
  })

  it('passa a warn quando ci sono job falliti, senza nasconderne il numero', async () => {
    const code = new Map<string, Queue>([
      [
        'rentri-sync',
        codaFinta({ workers: 1, counts: { waiting: 0, active: 0, delayed: 0, failed: 7 } }),
      ],
    ])

    const voce = (await probe.raccogli(code)).find(v => v.key === 'coda.rentri-sync')

    expect(voce?.state).toBe('warn')
    expect(voce?.detail).toContain('7 falliti')
  })

  it('dichiara unknown — non error — quando la coda non e interrogabile', async () => {
    const code = new Map<string, Queue>([
      ['rentri-sync', codaFinta({ errore: new Error('ECONNREFUSED') })],
    ])

    const voce = (await probe.raccogli(code)).find(v => v.key === 'coda.rentri-sync')

    expect(voce?.state).toBe('unknown')
    expect(voce?.detail).toContain('ECONNREFUSED')
  })

  it('dichiara unknown la coda non registrata in questo processo', async () => {
    const voce = (await probe.raccogli(new Map())).find(v => v.key === 'coda.cache-warming')

    expect(voce?.state).toBe('unknown')
    expect(voce?.detail).toContain('non registrata')
  })
})
