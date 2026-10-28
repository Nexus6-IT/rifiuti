/**
 * `CURRENT_TENANT_ID` è un ripiego solo per i test (RLS pezzo 2c): fuori da
 * `NODE_ENV=test` va ignorata, con un solo avviso. Ogni test carica il modulo
 * da zero (`isolateModules`) perché l'avviso "una volta sola" è uno stato di modulo.
 */
describe('TenantContext.getTenantId - CURRENT_TENANT_ID', () => {
  const envOriginale = { ...process.env }
  let warn: jest.SpyInstance

  const caricaTenantContext = (): typeof import('./tenant-context').TenantContext => {
    let modulo: typeof import('./tenant-context') | undefined
    jest.isolateModules(() => {
      // Stesso registry del modulo sotto test: lo spy deve stare sul SUO Logger.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Logger } = require('@nestjs/common')
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      modulo = require('./tenant-context')
    })
    return modulo!.TenantContext
  }

  afterEach(() => {
    process.env = { ...envOriginale }
    warn?.mockRestore()
  })

  it('getTenantId: CURRENT_TENANT_ID ignorata con NODE_ENV=production, un solo avviso', () => {
    process.env.NODE_ENV = 'production'
    process.env.CURRENT_TENANT_ID = 'azienda-segreta'
    const TenantContext = caricaTenantContext()

    expect(TenantContext.getTenantId()).toBeNull()
    expect(TenantContext.getTenantId()).toBeNull()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).not.toContain('azienda-segreta')
  })

  it('getTenantId: nessun avviso se la variabile non è impostata', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.CURRENT_TENANT_ID
    const TenantContext = caricaTenantContext()

    expect(TenantContext.getTenantId()).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('getTenantId: CURRENT_TENANT_ID usata con NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    process.env.CURRENT_TENANT_ID = 'azienda-test'
    const TenantContext = caricaTenantContext()

    expect(TenantContext.getTenantId()).toBe('azienda-test')
    expect(warn).not.toHaveBeenCalled()
  })

  it('getTenantId: lo store vince sulla variabile', () => {
    process.env.NODE_ENV = 'test'
    process.env.CURRENT_TENANT_ID = 'azienda-env'
    const TenantContext = caricaTenantContext()

    expect(
      TenantContext.run({ tenantId: 'azienda-store' }, () => TenantContext.getTenantId())
    ).toBe('azienda-store')
  })
})
