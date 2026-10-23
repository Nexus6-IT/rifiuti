import {
  RentriCredentialResolver,
  TenantSenzaCertificatoRentriError,
} from './rentri-credential.resolver'
import * as forge from 'node-forge'
import { TenantContext } from '../../core/context/tenant-context'

/**
 * Verifica la risoluzione per-tenant del certificato RENTRI: usa quello del
 * tenant se presente; la credenziale env vale SOLO per il tenant legato da
 * RENTRI_ENV_TENANT_ID (fail-closed per gli altri) e per le chiamate di
 * piattaforma senza tenant.
 */
describe('RentriCredentialResolver', () => {
  let credentialService: any
  let metrics: any
  const envConfig = {
    clientId: 'env-operator',
    certificatePem: 'ENV-CERT',
    privateKeyPem: 'ENV-KEY',
    algorithm: 'RS256' as const,
    // Credenziale env legata al solo tenant pilota (F1).
    envTenantId: 'tenant-pilota',
  }

  function makeResolver(config: any = envConfig) {
    credentialService = { getForTenant: jest.fn() }
    metrics = { rentriCredentialEnvFallback: { inc: jest.fn() } }
    return new RentriCredentialResolver(credentialService, config, metrics)
  }

  const credTenant = (privateKeyPem = 'TENANT-KEY', algorithm = 'ES256') => ({
    clientId: 'tenant-operator',
    certificatePem: 'TENANT-CERT',
    privateKeyPem,
    algorithm,
    environment: 'live',
  })

  it('usa il certificato del tenant corrente quando presente', async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue(credTenant())

    const cred = await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, () =>
      resolver.resolve()
    )

    expect(credentialService.getForTenant).toHaveBeenCalledWith('tenant-A')
    expect(cred).toMatchObject({
      clientId: 'tenant-operator',
      certificatePem: 'TENANT-CERT',
      source: 'tenant',
    })
  })

  it('tenant legato (RENTRI_ENV_TENANT_ID) senza credenziale propria: usa env', async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue(null)

    const cred = await resolver.resolve('tenant-pilota')

    expect(cred).toMatchObject({
      clientId: 'env-operator',
      certificatePem: 'ENV-CERT',
      source: 'env',
    })
  })

  it('altro tenant senza credenziale e non legato: TenantSenzaCertificatoRentriError, senza id nel messaggio', async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue(null)
    const warn = jest.spyOn((resolver as any).logger, 'warn').mockImplementation(() => undefined)

    const p = resolver.resolve('tenant-A')

    await expect(p).rejects.toBeInstanceOf(TenantSenzaCertificatoRentriError)
    await expect(p).rejects.toThrow(
      "L'azienda non ha un certificato RENTRI configurato: caricalo nella pagina del certificato RENTRI."
    )
    await expect(p).rejects.not.toThrow(/tenant-A/)
    // l'id del tenant sta nel log, non nel messaggio per l'utente
    expect(JSON.stringify(warn.mock.calls)).toContain('tenant-A')
    expect(metrics.rentriCredentialEnvFallback.inc).not.toHaveBeenCalled()
  })

  it('RENTRI_ENV_TENANT_ID vuota: nessun tenant puo usare env (fail-closed)', async () => {
    const resolver = makeResolver({ ...envConfig, envTenantId: undefined })
    credentialService.getForTenant.mockResolvedValue(null)

    await expect(resolver.resolve('tenant-pilota')).rejects.toBeInstanceOf(
      TenantSenzaCertificatoRentriError
    )
  })

  it("usa env quando non c'è alcun tenant (chiamata di piattaforma)", async () => {
    const resolver = makeResolver()
    const cred = await resolver.resolve()
    expect(cred.source).toBe('env')
    expect(credentialService.getForTenant).not.toHaveBeenCalled()
  })

  it("firma con l'algoritmo ricavato dalla chiave, non con la colonna: riga vecchia RSA + ES256", async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue(
      credTenant(forge.pki.privateKeyToPem(forge.pki.rsa.generateKeyPair(2048).privateKey))
    )

    const cred = await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, () =>
      resolver.resolve()
    )

    expect(cred.algorithm).toBe('RS256')
  })

  it("lancia se non c'è né tenant né credenziale env", async () => {
    const resolver = makeResolver({
      clientId: '',
      certificatePem: '',
      privateKeyPem: '',
      algorithm: 'RS256',
    })

    await expect(resolver.resolve()).rejects.toThrow('nessuna credenziale')
  })

  it('resolve(tenantId) non legge il TenantContext', async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue({
      ...credTenant('KEY-A', 'RS256'),
      clientId: 'op-a',
      certificatePem: 'CERT-A',
    })

    const cred = await TenantContext.run({ tenantId: 'tenant-b', userId: 'u1' }, () =>
      resolver.resolve('tenant-a')
    )

    expect(credentialService.getForTenant).toHaveBeenCalledTimes(1)
    expect(credentialService.getForTenant).toHaveBeenCalledWith('tenant-a')
    expect(cred.clientId).toBe('op-a')
  })

  it("tenant legato che usa env: warn con l'id, nessun materiale di chiave, una sola volta per tenant; contatore a ogni uso", async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue(null)
    const warn = jest.spyOn((resolver as any).logger, 'warn').mockImplementation(() => undefined)

    const cred = await resolver.resolve('tenant-pilota')
    await resolver.resolve('tenant-pilota')

    expect(cred.source).toBe('env')
    expect(warn).toHaveBeenCalledTimes(1)
    const testo = JSON.stringify(warn.mock.calls)
    expect(testo).toContain('tenant-pilota')
    expect(testo).not.toContain('ENV-KEY')
    expect(testo).not.toContain('ENV-CERT')
    expect(metrics.rentriCredentialEnvFallback.inc).toHaveBeenCalledTimes(2)
    expect(metrics.rentriCredentialEnvFallback.inc).toHaveBeenCalledWith({
      tenant_id: 'tenant-pilota',
    })
  })

  it("algoritmo discordante: warn una volta per tenant; 'risoluzione dal contesto': una volta per processo", async () => {
    const resolver = makeResolver()
    credentialService.getForTenant.mockResolvedValue(
      credTenant(forge.pki.privateKeyToPem(forge.pki.rsa.generateKeyPair(2048).privateKey))
    )
    const warn = jest.spyOn((resolver as any).logger, 'warn').mockImplementation(() => undefined)

    await resolver.resolve('tenant-A')
    await resolver.resolve('tenant-A')
    await resolver.resolve('tenant-B')
    expect(warn).toHaveBeenCalledTimes(2)

    warn.mockClear()
    await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, async () => {
      await resolver.resolve()
      await resolver.resolve()
    })
    const dalContesto = warn.mock.calls.filter(c => String(c[0]).includes('dal contesto'))
    expect(dalContesto).toHaveLength(1)
  })
})
