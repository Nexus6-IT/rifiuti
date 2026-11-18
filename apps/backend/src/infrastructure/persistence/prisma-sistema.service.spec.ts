/**
 * PrismaSistemaService — client per i job di sistema (ruolo DB BYPASSRLS).
 * Nessun database: si intercetta il costruttore di PrismaClient per leggere le
 * opzioni con cui viene creato.
 */

const opzioniCostruttore: any[] = []
const chiamateTransaction: unknown[][] = []

jest.mock('@prisma/client', () => {
  class PrismaClient {
    constructor(opzioni?: unknown) {
      opzioniCostruttore.push(opzioni)
    }
    $connect = jest.fn()
    $disconnect = jest.fn()
    // metodo di prototipo (come in Prisma): il service lo sovrascrive e chiama super
    $transaction(...args: unknown[]) {
      chiamateTransaction.push(args)
      return Promise.resolve('esito-base')
    }
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
    chiamateTransaction.length = 0
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

  describe('$transaction chiude i vincoli differiti (come il client applicativo)', () => {
    beforeEach(() => {
      process.env.DATABASE_URL = URL_APP
      process.env.DATABASE_URL_SISTEMA = URL_SISTEMA
    })

    it("forma interattiva: SET CONSTRAINTS ALL IMMEDIATE e' l'ultimo statement, dopo fn", async () => {
      const ordine: string[] = []
      const tx = {
        $executeRawUnsafe: jest.fn(async (sql: string) => {
          ordine.push(sql)
        }),
      }
      const servizio = new PrismaSistemaService()

      const esito = await servizio.$transaction(
        async (t: unknown) => {
          ordine.push('fn')
          expect(t).toBe(tx)
          return 42
        },
        { timeout: 1234 }
      )
      expect(esito).toBe('esito-base')

      const [fnAvvolta, opzioni] = chiamateTransaction[0] as [
        (t: unknown) => Promise<unknown>,
        unknown,
      ]
      expect(opzioni).toEqual({ timeout: 1234 })
      expect(await fnAvvolta(tx)).toBe(42)
      expect(ordine).toEqual(['fn', 'SET CONSTRAINTS ALL IMMEDIATE'])
    })

    it('se fn lancia, il SET non parte e l errore arriva', async () => {
      const tx = { $executeRawUnsafe: jest.fn() }
      const servizio = new PrismaSistemaService()
      await servizio.$transaction(async () => {
        throw new Error('boom')
      })
      const [fnCheLancia] = chiamateTransaction[0] as [(t: unknown) => Promise<unknown>]
      await expect(fnCheLancia(tx)).rejects.toThrow('boom')
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled()
    })

    it('forma batch: passa invariata, senza SET', async () => {
      const batch = [Promise.resolve(1)]
      await new PrismaSistemaService().$transaction(batch as never, { timeout: 5 } as never)
      expect(chiamateTransaction[0]).toEqual([batch, { timeout: 5 }])
      expect(chiamateTransaction[0][0]).toBe(batch)
    })
  })
})
