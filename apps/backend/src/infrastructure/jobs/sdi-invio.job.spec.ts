import { SdiInvioJob } from './sdi-invio.job'
import type { EsitoGiroSdi } from '../../application/sdi/elabora-invio-sdi.service'

const VUOTO: EsitoGiroSdi = {
  stalli: 0,
  riconciliate: 0,
  inviate: 0,
  rifiutate: 0,
  ritentate: 0,
  incerte: 0,
  errori: 0,
}

describe('SdiInvioJob', () => {
  const originale = process.env.SDI_INVII_ATTIVI
  let giroAzienda: jest.Mock
  let tenantConModulo: jest.Mock
  let findMany: jest.Mock
  let job: SdiInvioJob

  beforeEach(() => {
    delete process.env.SDI_INVII_ATTIVI
    giroAzienda = jest.fn().mockResolvedValue(VUOTO)
    tenantConModulo = jest.fn().mockResolvedValue(new Set(['a', 'c']))
    findMany = jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    job = new SdiInvioJob(
      { tenant: { findMany } } as never,
      { tenantConModulo } as never,
      { giroAzienda } as never
    )
  })
  afterEach(() => {
    if (originale === undefined) delete process.env.SDI_INVII_ATTIVI
    else process.env.SDI_INVII_ATTIVI = originale
  })

  it('senza SDI_INVII_ATTIVI il giro passa invii=false (default spento)', async () => {
    await job.eseguiInvio()
    expect(giroAzienda).toHaveBeenCalledTimes(2)
    for (const chiamata of giroAzienda.mock.calls) expect(chiamata[2]).toEqual({ invii: false })
  })

  it('con SDI_INVII_ATTIVI=true passa invii=true', async () => {
    process.env.SDI_INVII_ATTIVI = 'true'
    await job.eseguiInvio()
    expect(giroAzienda.mock.calls[0][2]).toEqual({ invii: true })
  })

  it('elabora solo le aziende col modulo sdi, con UNA query sui moduli', async () => {
    await job.eseguiInvio()
    expect(tenantConModulo).toHaveBeenCalledTimes(1)
    expect(tenantConModulo).toHaveBeenCalledWith(['a', 'b', 'c'], 'sdi')
    expect(giroAzienda.mock.calls.map(c => c[0])).toEqual(['a', 'c'])
  })

  it('un errore su un azienda non ferma le altre', async () => {
    giroAzienda.mockRejectedValueOnce(new Error('guasto')).mockResolvedValueOnce({
      ...VUOTO,
      inviate: 2,
    })
    const esito = await job.eseguiInvio()
    expect(esito).toMatchObject({ aziende: 2, aziendeInErrore: 1, inviate: 2 })
  })

  it('due giri sovrapposti nello stesso processo: il secondo salta', async () => {
    let sblocca!: () => void
    giroAzienda.mockImplementationOnce(
      () => new Promise<EsitoGiroSdi>(r => (sblocca = () => r(VUOTO)))
    )
    const primo = job.eseguiInvio()
    await new Promise(r => setImmediate(r))
    expect(await job.eseguiInvio()).toBeNull()
    sblocca()
    await primo
    expect(giroAzienda).toHaveBeenCalledTimes(2)
  })

  it('un guasto della lettura delle aziende non lancia (si segnala) e il flag si libera', async () => {
    findMany.mockRejectedValueOnce(new Error('db giu'))
    await expect(job.eseguiInvio()).resolves.toBeNull()
    await expect(job.eseguiInvio()).resolves.toMatchObject({ aziende: 2 })
  })
})
