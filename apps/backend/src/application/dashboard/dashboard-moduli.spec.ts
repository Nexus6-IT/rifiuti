/**
 * Cruscotto filtrato per modulo nel service (seguito dei moduli commerciali): le parti che
 * dipendono da un modulo non attivo non si calcolano, e la forma della risposta non cambia.
 */
import { AttenzioneController } from '../../api/dashboard/attenzione.controller'
import type { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type { LoggerService } from '../../core/logger/logger.service'
import type { AnalyticsService } from '../analytics/analytics.service'
import { GetDashboardUseCase } from '../analytics/get-dashboard.use-case'
import type { FeatureKey } from '../admin/feature-catalog'
import type { ModuliAttiviService } from '../admin/moduli-attivi.service'
import { RaccogliAttenzioneUseCase } from './raccogli-attenzione.use-case'
import { RaccogliIndicatoriAzioneUseCase } from './raccogli-indicatori-azione.use-case'

const TENANT = 'tenant-uuid-001'
const moduliDi = (...m: FeatureKey[]) => new Set<FeatureKey>(m)
const moduliService = (...m: FeatureKey[]) =>
  ({ moduliAttivi: jest.fn().mockResolvedValue(m) }) as unknown as jest.Mocked<ModuliAttiviService>

function prismaFinto() {
  const db = {
    rentriCredential: { findUnique: jest.fn().mockResolvedValue({ certificatePem: 'PEM' }) },
    autorizzazioneImpianto: { findMany: jest.fn().mockResolvedValue([]) },
    trasportatore: { findMany: jest.fn().mockResolvedValue([]) },
    destinatario: { findMany: jest.fn().mockResolvedValue([]) },
    fIR: {
      groupBy: jest.fn().mockResolvedValue([{ rentriSyncStatus: 'PENDING', _count: { _all: 2 } }]),
    },
    rentriUnitaLocale: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { numIscrSito: 'S1', denominazione: 'Sede', dimensioneScortaDesiderata: 5 },
        ]),
    },
  }
  return { db, prisma: { db } as unknown as PrismaService }
}

describe('RaccogliAttenzioneUseCase: voci per modulo', () => {
  it('senza rentri non legge la credenziale; senza anagrafiche non legge trasportatori e destinatari', async () => {
    const { db, prisma } = prismaFinto()
    const r = await new RaccogliAttenzioneUseCase(prisma).raccogli(TENANT, moduliDi('fir'))
    expect(r.voci).toEqual([])
    expect(db.rentriCredential.findUnique).not.toHaveBeenCalled()
    expect(db.trasportatore.findMany).not.toHaveBeenCalled()
    expect(db.destinatario.findMany).not.toHaveBeenCalled()
    // Le autorizzazioni impianto non dipendono da un modulo.
    expect(db.autorizzazioneImpianto.findMany).toHaveBeenCalledTimes(1)
  })

  it('con rentri e anagrafiche legge tutto', async () => {
    const { db, prisma } = prismaFinto()
    await new RaccogliAttenzioneUseCase(prisma).raccogli(TENANT, moduliDi('rentri', 'anagrafiche'))
    expect(db.rentriCredential.findUnique).toHaveBeenCalledTimes(1)
    expect(db.trasportatore.findMany).toHaveBeenCalledTimes(1)
    expect(db.destinatario.findMany).toHaveBeenCalledTimes(1)
  })
})

describe('RaccogliIndicatoriAzioneUseCase: voci per modulo', () => {
  const scorta = { contaTotaleDisponibili: jest.fn().mockResolvedValue(1) }

  it('senza rentri: nessuna voce e nessuna lettura', async () => {
    const { db, prisma } = prismaFinto()
    const r = await new RaccogliIndicatoriAzioneUseCase(prisma, scorta as never).raccogli(
      TENANT,
      moduliDi('fir', 'anagrafiche')
    )
    expect(r).toEqual({ voci: [] })
    expect(db.fIR.groupBy).not.toHaveBeenCalled()
    expect(db.rentriUnitaLocale.findMany).not.toHaveBeenCalled()
  })

  it('con rentri: formulari da trasmettere e scorta', async () => {
    const { prisma } = prismaFinto()
    const r = await new RaccogliIndicatoriAzioneUseCase(prisma, scorta as never).raccogli(
      TENANT,
      moduliDi('rentri')
    )
    expect(r.voci.map(v => v.chiave).sort()).toEqual([
      'formulari-da-trasmettere',
      'scorta-vidimata-S1',
    ])
  })
})

describe('AttenzioneController: una sola lettura dei moduli per richiesta', () => {
  it('legge i moduli una volta e li passa ai due use case', async () => {
    const moduli = moduliService('rentri')
    const attenzione = { raccogli: jest.fn().mockResolvedValue({ voci: [] }) }
    const indicatori = { raccogli: jest.fn().mockResolvedValue({ voci: [] }) }
    const controller = new AttenzioneController(attenzione as never, indicatori as never, moduli)
    await controller.getAttenzione({ user: { tenantId: TENANT }, tenantId: TENANT })
    expect(moduli.moduliAttivi).toHaveBeenCalledTimes(1)
    expect(attenzione.raccogli).toHaveBeenCalledWith(TENANT, new Set(['rentri']))
    expect(indicatori.raccogli).toHaveBeenCalledWith(TENANT, new Set(['rentri']))
  })
})

describe('GetDashboardUseCase: blocco rentri per modulo', () => {
  function crea(moduli: ModuliAttiviService) {
    const analytics: Record<string, jest.Mock> = {
      getTotalFIRs: jest.fn().mockResolvedValue(0),
      getFIRsByStatus: jest.fn().mockResolvedValue({}),
      getTotalWasteQuantity: jest.fn().mockResolvedValue(0),
      getWasteByCERCode: jest.fn().mockResolvedValue([]),
      getWasteByDestination: jest.fn().mockResolvedValue({ recyclingRate: 0 }),
      getRENTRISyncRate: jest.fn().mockResolvedValue({ rate: 0.5, total: 4, synced: 2 }),
      getSignatureCompletionRate: jest.fn().mockResolvedValue({ rate: 0, total: 0, completed: 0 }),
      getAverageSignatureTime: jest.fn().mockResolvedValue(0),
      getComplianceScore: jest.fn().mockResolvedValue({ score: 0, level: 'CRITICAL', factors: {} }),
      getOverdueFIRs: jest.fn().mockResolvedValue(0),
      getMonthOverMonthGrowth: jest
        .fn()
        .mockResolvedValue({ current: 0, previous: 0, percentage: 0 }),
      predictNextMonthVolume: jest.fn().mockResolvedValue(null),
      getTopProducers: jest.fn().mockResolvedValue([]),
      getTopCarriers: jest.fn().mockResolvedValue([]),
    }
    const logger = { setContext: jest.fn(), info: jest.fn(), error: jest.fn() }
    const useCase = new GetDashboardUseCase(
      analytics as unknown as AnalyticsService,
      logger as unknown as LoggerService,
      moduli
    )
    return { analytics, useCase }
  }

  it('senza rentri: nessuna lettura RENTRI, il blocco resta con i valori a zero', async () => {
    const moduli = moduliService('fir')
    const { analytics, useCase } = crea(moduli)
    const r = await useCase.execute({ tenantId: TENANT })
    expect(analytics.getRENTRISyncRate).not.toHaveBeenCalled()
    expect(r.rentri).toEqual({ syncRate: 0, totalCompleted: 0, synced: 0, pending: 0 })
    expect(moduli.moduliAttivi).toHaveBeenCalledTimes(1)
  })

  it('con rentri: legge il tasso di sincronizzazione', async () => {
    const { analytics, useCase } = crea(moduliService('rentri'))
    const r = await useCase.execute({ tenantId: TENANT })
    expect(analytics.getRENTRISyncRate).toHaveBeenCalledWith(TENANT)
    expect(r.rentri).toEqual({ syncRate: 0.5, totalCompleted: 4, synced: 2, pending: 2 })
  })
})
