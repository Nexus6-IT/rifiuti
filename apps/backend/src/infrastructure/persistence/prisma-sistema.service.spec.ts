/**
 * PrismaSistemaService — client per i job di sistema (ruolo DB BYPASSRLS).
 * Nessun database: si intercetta il costruttore di PrismaClient per leggere le
 * opzioni con cui viene creato.
 */

const opzioniCostruttore: any[] = []

jest.mock('@prisma/client', () => {
  class PrismaClient {
    constructor(opzioni?: unknown) {
      opzioniCostruttore.push(opzioni)
    }
    $connect = jest.fn()
    $disconnect = jest.fn()
  }
  const reale = jest.requireActual('@prisma/client')
  return { ...reale, PrismaClient }
})

import { Logger } from '@nestjs/common'
import { PrismaSistemaService } from './prisma-sistema.service'
import { PrismaModule } from './prisma.module'

const URL_APP = 'postgresql://wasteflow_app:segreto-app@postgres:5432/wasteflow'
const URL_SISTEMA = 'postgresql://wasteflow_sistema:segreto-sistema@postgres:5432/wasteflow'

describe('PrismaSistemaService', () => {
  const envOriginale = { ...process.env }

  beforeEach(() => {
    opzioniCostruttore.length = 0
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.env = { ...envOriginale }
    jest.restoreAllMocks()
  })

  it("con DATABASE_URL_SISTEMA usa quell'URL", () => {
    process.env.DATABASE_URL = URL_APP
    process.env.DATABASE_URL_SISTEMA = URL_SISTEMA

    new PrismaSistemaService()

    expect(opzioniCostruttore[0]).toEqual({ datasources: { db: { url: URL_SISTEMA } } })
    expect(Logger.prototype.warn).not.toHaveBeenCalled()
  })

  it('senza DATABASE_URL_SISTEMA usa DATABASE_URL e logga un solo warn senza URL', () => {
    process.env.DATABASE_URL = URL_APP
    delete process.env.DATABASE_URL_SISTEMA

    new PrismaSistemaService()

    expect(opzioniCostruttore[0]).toEqual({ datasources: { db: { url: URL_APP } } })
    const warn = Logger.prototype.warn as jest.Mock
    expect(warn).toHaveBeenCalledTimes(1)
    const messaggio = String(warn.mock.calls[0][0])
    expect(messaggio).toBe(
      "DATABASE_URL_SISTEMA assente: il client di sistema usa la connessione dell'applicazione"
    )
    expect(messaggio).not.toContain('segreto-app')
    expect(messaggio).not.toContain('postgresql://')
  })

  it('una DATABASE_URL_SISTEMA vuota vale come assente', () => {
    process.env.DATABASE_URL = URL_APP
    process.env.DATABASE_URL_SISTEMA = ''

    new PrismaSistemaService()

    expect(opzioniCostruttore[0].datasources.db.url).toBe(URL_APP)
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1)
  })

  it('PrismaModule esporta PrismaSistemaService', () => {
    const providers: unknown[] = Reflect.getMetadata('providers', PrismaModule)
    const exports: unknown[] = Reflect.getMetadata('exports', PrismaModule)
    expect(providers).toContain(PrismaSistemaService)
    expect(exports).toContain(PrismaSistemaService)
  })
})
