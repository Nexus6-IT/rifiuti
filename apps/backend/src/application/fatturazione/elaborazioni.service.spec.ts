import { HttpException } from '@nestjs/common'
import { Queue } from 'bullmq'
import { ElaborazioniService, idJobFatturazione } from './elaborazioni.service'
import type { ParametriElaborazione } from './selezione-fatturazione'

const P: ParametriElaborazione = {
  periodoDal: '2026-03-01',
  periodoAl: '2026-03-31',
  dataDocumento: '2026-04-05',
  raggruppamento: 'PER_CONTRATTO',
  includiArretrati: false,
  filtri: {},
}

/** Servizio con un database che esplode se lo si tocca: le validazioni stanno prima. */
function servizio(adesso: string = '2026-04-10T10:00:00.000Z') {
  const prisma = new Proxy(
    {},
    {
      get() {
        throw new Error('il database non andava toccato')
      },
    }
  )
  const s = new ElaborazioniService(
    prisma as never,
    {} as never,
    { add: jest.fn() } as unknown as Queue
  )
  s.orologio = () => new Date(adesso)
  return s
}

const esito = async (p: Promise<unknown>): Promise<{ status: number; codice: unknown }> => {
  try {
    await p
  } catch (e) {
    if (e instanceof HttpException) {
      const corpo = e.getResponse() as { error?: string }
      return { status: e.getStatus(), codice: corpo.error }
    }
    throw e
  }
  throw new Error('attesa un’eccezione')
}

describe('idJobFatturazione', () => {
  it('usa il trattino: BullMQ 5.62 vieta i due punti negli id', () => {
    const id = idJobFatturazione({ tipo: 'anteprima', elaborazioneId: 'abc', versione: 2 })
    expect(id).toBe('anteprima-abc-v2')
    expect(id).not.toContain(':')
  })
  it('la versione fa un id diverso per ogni ricalcolo', () => {
    const a = idJobFatturazione({ tipo: 'anteprima', elaborazioneId: 'x', versione: 1 })
    const b = idJobFatturazione({ tipo: 'anteprima', elaborazioneId: 'x', versione: 2 })
    expect(a).not.toBe(b)
  })
})

describe('ElaborazioniService.avvia: controlli prima del database', () => {
  it.each([
    ['periodo a cavallo d’anno', { periodoDal: '2025-12-01', periodoAl: '2026-01-31' }],
    ['periodo al contrario', { periodoDal: '2026-03-31', periodoAl: '2026-03-01' }],
    ['dataDocumento prima della fine del periodo', { dataDocumento: '2026-03-30' }],
    ['data inesistente', { periodoAl: '2026-02-30' }],
    ['data con l’ora', { dataDocumento: '2026-04-05T10:00:00Z' }],
  ])('%s: 400 PERIODO_NON_VALIDO', async (_nome, variante) => {
    const r = await esito(servizio().avvia('t', 'u', { ...P, ...variante }))
    expect(r).toEqual({ status: 400, codice: 'PERIODO_NON_VALIDO' })
  })

  it('dataDocumento di domani: 400 DATA_FUTURA', async () => {
    const r = await esito(
      servizio('2026-04-10T10:00:00.000Z').avvia('t', 'u', { ...P, dataDocumento: '2026-04-11' })
    )
    expect(r).toEqual({ status: 400, codice: 'DATA_FUTURA' })
  })

  it('alle 00:30 italiane (23:30 UTC di ieri) il giorno italiano e’ gia’ quello di oggi: non e’ DATA_FUTURA', async () => {
    // 23:30 UTC del 9 aprile = 01:30 del 10 aprile a Roma (ora legale): «oggi» e' il 10.
    // Il controllo passa e il servizio arriva al database, che qui esplode: lo si vede dal messaggio.
    await expect(
      servizio('2026-04-09T23:30:00.000Z').avvia('t', 'u', { ...P, dataDocumento: '2026-04-10' })
    ).rejects.toThrow('il database non andava toccato')
  })

  it('con l’UTC ancora il 9 aprile ma Roma al 10, l’11 e’ comunque futuro', async () => {
    const r = await esito(
      servizio('2026-04-09T23:30:00.000Z').avvia('t', 'u', { ...P, dataDocumento: '2026-04-11' })
    )
    expect(r.codice).toBe('DATA_FUTURA')
  })

  it('un filtro con un id che non e’ un UUID: 400', async () => {
    const r = await esito(
      servizio().avvia('t', 'u', { ...P, filtri: { clienteIds: ['non-un-uuid'] } })
    )
    expect(r).toEqual({ status: 400, codice: 'FILTRO_NON_VALIDO' })
  })
})

describe('ElaborazioniService: paginazione e validazioni', () => {
  it('lista e documenti rifiutano una dimensione oltre 100 e accettano 100', async () => {
    const s = servizio()
    expect((await esito(s.lista('t', { pagina: 1, dimensione: 101 }))).codice).toBe(
      'PAGINAZIONE_NON_VALIDA'
    )
    expect((await esito(s.lista('t', { pagina: 0, dimensione: 10 }))).codice).toBe(
      'PAGINAZIONE_NON_VALIDA'
    )
    await expect(s.lista('t', { pagina: 1, dimensione: 100 })).rejects.toThrow(
      'il database non andava toccato'
    )
    expect(
      (
        await esito(
          s.documenti('t', '00000000-0000-4000-8000-000000000000', { pagina: 1, dimensione: 101 })
        )
      ).codice
    ).toBe('PAGINAZIONE_NON_VALIDA')
  })

  it('chiediDefinitiva: un id che non e’ un UUID e’ un 404 senza toccare il database', async () => {
    expect(
      await esito(servizio().chiediDefinitiva('t', 'u', 'xx', { impronta: 'x', versione: 1 }))
    ).toEqual({ status: 404, codice: 'ELABORAZIONE_NON_TROVATA' })
  })

  it('l’id del job della definitiva ha il trattino e la versione (Q5)', () => {
    expect(idJobFatturazione({ tipo: 'definitiva', elaborazioneId: 'abc', versione: 3 })).toBe(
      'definitiva-abc-v3'
    )
  })

  it('un id che non e’ un UUID e’ un 404 senza toccare il database', async () => {
    const s = servizio()
    expect(await esito(s.dettaglio('t', 'xx'))).toEqual({
      status: 404,
      codice: 'ELABORAZIONE_NON_TROVATA',
    })
    expect((await esito(s.scarta('t', 'u', 'xx', 1))).status).toBe(404)
    expect((await esito(s.escludi('t', 'xx', 'yy', true))).status).toBe(404)
  })
})
