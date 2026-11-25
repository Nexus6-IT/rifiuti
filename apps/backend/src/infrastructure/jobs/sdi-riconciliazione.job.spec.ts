import { SdiRiconciliazioneJob } from './sdi-riconciliazione.job'

describe('SdiRiconciliazioneJob', () => {
  let giroAzienda: jest.Mock
  let tenantConModulo: jest.Mock
  let findMany: jest.Mock
  let job: SdiRiconciliazioneJob

  beforeEach(() => {
    giroAzienda = jest.fn().mockResolvedValue({ controllate: 1, aggiornate: 1, errori: 0 })
    tenantConModulo = jest.fn().mockResolvedValue(new Set(['a', 'c']))
    findMany = jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    job = new SdiRiconciliazioneJob(
      { tenant: { findMany } } as never,
      { tenantConModulo } as never,
      { giroAzienda } as never
    )
  })

  it('elabora solo le aziende col modulo sdi, con UNA query sui moduli', async () => {
    const r = await job.eseguiRiconciliazione()
    expect(tenantConModulo).toHaveBeenCalledTimes(1)
    expect(tenantConModulo).toHaveBeenCalledWith(['a', 'b', 'c'], 'sdi')
    expect(giroAzienda.mock.calls.map(c => c[0])).toEqual(['a', 'c'])
    expect(r).toMatchObject({ aziende: 2, controllate: 2, aggiornate: 2 })
  })

  it('la query delle aziende richiede una configurazione SDI', async () => {
    await job.eseguiRiconciliazione()
    expect(JSON.stringify(findMany.mock.calls[0][0])).toContain('configurazioniSdi')
  })

  it('un errore su un’azienda non ferma le altre', async () => {
    giroAzienda.mockRejectedValueOnce(new Error('guasto'))
    const r = await job.eseguiRiconciliazione()
    expect(giroAzienda).toHaveBeenCalledTimes(2)
    expect(r?.aziendeInErrore).toBe(1)
  })

  it('un errore dell’elenco non butta giu il job', async () => {
    findMany.mockRejectedValue(new Error('db'))
    await expect(job.eseguiRiconciliazione()).resolves.toBeNull()
  })

  it('giri sovrapposti: il secondo salta', async () => {
    let sblocca: () => void = () => undefined
    findMany.mockReturnValue(new Promise(r => (sblocca = () => r([]))))
    const primo = job.eseguiRiconciliazione()
    expect(await job.eseguiRiconciliazione()).toBeNull()
    sblocca()
    await primo
  })
})
