import { RentriCredentialResolver } from './rentri-credential.resolver'
import { TenantContext } from '../../core/context/tenant-context'

/**
 * Verifica la risoluzione per-tenant del certificato RENTRI: usa quello del
 * tenant corrente se presente, altrimenti il fallback da env; errore se nessuno.
 */
describe('RentriCredentialResolver', () => {
  let credentialService: any
  const envConfig = {
    clientId: 'env-operator',
    certificatePem: 'ENV-CERT',
    privateKeyPem: 'ENV-KEY',
    algorithm: 'RS256' as const,
  }

  function makeResolver(config: any = envConfig) {
    credentialService = { getForTenant: jest.fn() }
    return new RentriCredentialResolver(credentialService, config)
  }

  it('usa il certificato del tenant corrente quando presente', async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue({
      clientId: 'tenant-operator',
      certificatePem: 'TENANT-CERT',
      privateKeyPem: 'TENANT-KEY',
      algorithm: 'ES256',
      environment: 'live',
    })

    const cred = await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, () =>
      resolver.resolve(),
    )

    expect(credentialService.getForTenant).toHaveBeenCalledWith('tenant-A')
    expect(cred).toMatchObject({ clientId: 'tenant-operator', certificatePem: 'TENANT-CERT', source: 'tenant' })
  })

  it('ricade sul certificato da env se il tenant non ha credenziali', async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue(null)

    const cred = await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, () =>
      resolver.resolve(),
    )

    expect(cred).toMatchObject({ clientId: 'env-operator', certificatePem: 'ENV-CERT', source: 'env' })
  })

  it('usa env quando non c\'è alcun TenantContext', async () => {
    const resolver = makeResolver()
    const cred = await resolver.resolve()
    expect(cred.source).toBe('env')
    expect(credentialService.getForTenant).not.toHaveBeenCalled()
  })

  it('lancia se non c\'è né credenziale tenant né fallback env', async () => {
    const resolver = makeResolver({ clientId: '', certificatePem: '', privateKeyPem: '', algorithm: 'RS256' })
    credentialService.getForTenant.mockResolvedValue(null)

    await expect(
      TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, () => resolver.resolve()),
    ).rejects.toThrow('nessuna credenziale')
  })
})
