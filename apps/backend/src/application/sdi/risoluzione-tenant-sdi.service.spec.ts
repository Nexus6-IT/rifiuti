import { RisoluzioneTenantSdiService } from './risoluzione-tenant-sdi.service'

describe('RisoluzioneTenantSdiService', () => {
  function sistemaFinto(risultato: unknown) {
    const findUnique = jest.fn().mockResolvedValue(risultato)
    const altro = jest.fn()
    // Qualunque altro accesso al client di sistema fa fallire il test.
    const sistema = new Proxy(
      { configurazioneSdi: { findUnique } },
      {
        get: (t, k) => (k in t ? (t as never)[k] : altro),
      }
    )
    return { sistema: sistema as never, findUnique, altro }
  }

  it('token sconosciuto -> null', async () => {
    const { sistema, findUnique } = sistemaFinto(null)
    await expect(
      new RisoluzioneTenantSdiService(sistema).daToken('a'.repeat(64))
    ).resolves.toBeNull()
    expect(findUnique).toHaveBeenCalledWith({
      where: { webhookTokenSha256: 'a'.repeat(64) },
      select: { tenantId: true, provider: true },
    })
  })

  it('token noto -> azienda e provider, con UNA sola query di sistema', async () => {
    const { sistema, findUnique, altro } = sistemaFinto({ tenantId: 't-1', provider: 'fake' })
    await expect(new RisoluzioneTenantSdiService(sistema).daToken('b'.repeat(64))).resolves.toEqual(
      {
        tenantId: 't-1',
        provider: 'fake',
      }
    )
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(altro).not.toHaveBeenCalled()
  })
})
