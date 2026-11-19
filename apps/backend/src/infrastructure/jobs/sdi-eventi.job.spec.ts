import { SdiEventiJob } from './sdi-eventi.job'

const VUOTO = { elaborati: 0, inAttesa: 0, scartati: 0, errori: 0 }

describe('SdiEventiJob', () => {
  let findMany: jest.Mock
  let giroAzienda: jest.Mock
  let job: SdiEventiJob

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([{ tenantId: 'a' }, { tenantId: 'b' }])
    giroAzienda = jest.fn().mockResolvedValue(VUOTO)
    job = new SdiEventiJob({ eventoSdiRicevuto: { findMany } } as never, { giroAzienda } as never)
  })

  it('senza eventi da elaborare non fa nulla (default in produzione)', async () => {
    findMany.mockResolvedValue([])
    const r = await job.eseguiEventi()
    expect(r).toEqual({ aziende: 0, aziendeInErrore: 0, elaborati: 0 })
    expect(giroAzienda).not.toHaveBeenCalled()
  })

  it('elenca solo le aziende con eventi non elaborati e li elabora azienda per azienda', async () => {
    giroAzienda.mockResolvedValue({ ...VUOTO, elaborati: 2 })
    const r = await job.eseguiEventi()
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { elaboratoIl: null }, distinct: ['tenantId'] })
    )
    expect(giroAzienda.mock.calls.map(c => c[0])).toEqual(['a', 'b'])
    expect(r?.elaborati).toBe(4)
  })

  it('un errore su un’azienda non ferma le altre', async () => {
    giroAzienda.mockRejectedValueOnce(new Error('guasto')).mockResolvedValueOnce(VUOTO)
    const r = await job.eseguiEventi()
    expect(giroAzienda).toHaveBeenCalledTimes(2)
    expect(r?.aziendeInErrore).toBe(1)
  })

  it('due giri sovrapposti nello stesso processo: il secondo salta', async () => {
    let sblocca: () => void = () => undefined
    findMany.mockReturnValue(new Promise(r => (sblocca = () => r([]))))
    const primo = job.eseguiEventi()
    expect(await job.eseguiEventi()).toBeNull()
    sblocca()
    await primo
  })

  it('un errore dell’elenco non butta giu il job: restituisce null', async () => {
    findMany.mockRejectedValue(new Error('db'))
    await expect(job.eseguiEventi()).resolves.toBeNull()
  })
})
