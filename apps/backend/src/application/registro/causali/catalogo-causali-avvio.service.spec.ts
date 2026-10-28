import { Logger } from '@nestjs/common'
import {
  CatalogoCausaliAvvioService,
  MESSAGGIO_CATALOGO_CAUSALI_VUOTO,
} from './catalogo-causali-avvio.service'

describe('CatalogoCausaliAvvioService', () => {
  let count: jest.Mock
  let errorSpy: jest.SpyInstance
  let service: CatalogoCausaliAvvioService

  beforeEach(() => {
    count = jest.fn()
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    service = new CatalogoCausaliAvvioService({ causaleRegistro: { count } } as never)
  })

  afterEach(() => jest.restoreAllMocks())

  it('logga un errore chiaro, senza tenant, se il catalogo e\' vuoto', async () => {
    count.mockResolvedValue(0)

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(MESSAGGIO_CATALOGO_CAUSALI_VUOTO)
    expect(MESSAGGIO_CATALOGO_CAUSALI_VUOTO).toContain('causali_registro')
    expect(MESSAGGIO_CATALOGO_CAUSALI_VUOTO).not.toMatch(/tenant/i)
  })

  it('non logga nulla se il catalogo ha righe', async () => {
    count.mockResolvedValue(11)

    await expect(service.verifica()).resolves.toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('non blocca l\'avvio se la lettura fallisce: logga e basta', async () => {
    count.mockRejectedValue(new Error('relation "causali_registro" does not exist'))

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist'))
  })
})
