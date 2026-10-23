import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService as PrismaServiceDatabase } from './prisma.service'
import { PrismaModule as PrismaModuleDatabase } from './prisma.module'
import { PrismaService as PrismaServicePersistence } from '../persistence/prisma.service'
import { PrismaModule as PrismaModulePersistence } from '../persistence/prisma.module'

describe('PrismaService unico', () => {
  afterEach(() => jest.restoreAllMocks())

  it('PrismaService di database e di persistence sono la stessa classe', () => {
    expect(PrismaServiceDatabase === PrismaServicePersistence).toBe(true)
  })

  it('un modulo che importa entrambi i PrismaModule riceve la stessa istanza', async () => {
    @Module({ imports: [PrismaModuleDatabase, PrismaModulePersistence] })
    class AppDiProva {}

    // Nessuna connessione reale: il ciclo di vita (che chiama $connect) e' stubbato
    jest.spyOn(PrismaServicePersistence.prototype, 'onModuleInit').mockResolvedValue(undefined)
    jest.spyOn(PrismaServicePersistence.prototype, 'onModuleDestroy').mockResolvedValue(undefined)

    const moduleRef = await Test.createTestingModule({ imports: [AppDiProva] }).compile()

    // Con una sola classe e un solo provider esiste un'unica istanza (un solo pool)
    const daDatabase = moduleRef.get(PrismaServiceDatabase, { strict: false })
    const daPersistence = moduleRef.get(PrismaServicePersistence, { strict: false })
    expect(daDatabase === daPersistence).toBe(true)
  })
})
