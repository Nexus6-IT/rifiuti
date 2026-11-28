import { SdiSondaJob } from './sdi-sonda.job'

describe('SdiSondaJob', () => {
  let giroAzienda: jest.Mock
  let tenantConModulo: jest.Mock
  let findMany: jest.Mock
  let job: SdiSondaJob

  beforeEach(() => {
    giroAzienda = jest.fn().mockResolvedValue({ problemi: 1, avvisiCreati: 2 })
    tenantConModulo = jest.fn().mockResolvedValue(new Set(['a', 'c']))
    findMany = jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    job = new SdiSondaJob(
      { tenant: { findMany } } as never,
      { tenantConModulo } as never,
      { giroAzienda } as never
    )
  })

  it('elabora solo le aziende col modulo sdi, con UNA query sui moduli', async () => {
    const r = await job.eseguiSonda()
    expect(tenantConModulo).toHaveBeenCalledTimes(1)
    expect(tenantConModulo).toHaveBeenCalledWith(['a', 'b', 'c'], 'sdi')
    expect(giroAzienda.mock.calls.map(c => c[0])).toEqual(['a', 'c'])
    expect(r).toEqual({ aziende: 2, aziendeInErrore: 0, problemi: 2, avvisiCreati: 4 })
  })

  it('considera anche le aziende senza configurazione: le trasmissioni restano dopo un cambio provider', async () => {
    await job.eseguiSonda()
    expect(JSON.stringify(findMany.mock.calls[0][0])).toContain('trasmissioniSdi')
  })

  it('un errore su un’azienda non ferma le altre', async () => {
    giroAzienda.mockRejectedValueOnce(new Error('guasto'))
    const r = await job.eseguiSonda()
    expect(giroAzienda).toHaveBeenCalledTimes(2)
    expect(r?.aziendeInErrore).toBe(1)
  })

  it('un errore dell’elenco non butta giu il job', async () => {
    findMany.mockRejectedValue(new Error('db'))
    await expect(job.eseguiSonda()).resolves.toBeNull()
  })

  it('giri sovrapposti: il secondo salta', async () => {
    let sblocca: () => void = () => undefined
    findMany.mockReturnValue(new Promise(r => (sblocca = () => r([]))))
    const primo = job.eseguiSonda()
    expect(await job.eseguiSonda()).toBeNull()
    sblocca()
    await primo
  })
})
