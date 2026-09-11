import { RaccogliIndicatoriAzioneUseCase } from './raccogli-indicatori-azione.use-case'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

const TENANT = 'tenant-uuid-001'

// L'use case legge tutti i model dal client esteso `this.prisma.db.<model>`
// (difesa in profondità RLS, rilievo revisione finale 2026-09-11), non dal
// client nudo: il mock riproduce quella forma, non `prisma.<model>` diretto.
function buildPrisma(overrides: any = {}): PrismaService {
  return {
    db: {
      fIR: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      rentriUnitaLocale: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides,
    },
  } as unknown as PrismaService
}

function buildScortaRepo(overrides: any = {}) {
  return {
    contaTotaleDisponibili: jest.fn().mockResolvedValue(0),
    ...overrides,
  }
}

describe('RaccogliIndicatoriAzioneUseCase', () => {
  describe('formulari da trasmettere a RENTRI', () => {
    it('con formulari emessi e non sincronizzati restituisce una voce di gravità avviso', async () => {
      const prisma = buildPrisma({
        fIR: {
          groupBy: jest
            .fn()
            .mockResolvedValue([{ rentriSyncStatus: 'PENDING', _count: { _all: 3 } }]),
        },
      })
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, buildScortaRepo())

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      const [voce] = risultato.voci
      expect(voce.chiave).toBe('formulari-da-trasmettere')
      expect(voce.gravita).toBe('avviso')
      expect(voce.dettaglio).toMatch(/3/)
      expect(voce.azione?.rotta).toBe('/fir')

      expect(prisma.db.fIR.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT }),
        })
      )
    })

    it('con almeno un tentativo fallito restituisce gravità critico', async () => {
      const prisma = buildPrisma({
        fIR: {
          groupBy: jest.fn().mockResolvedValue([
            { rentriSyncStatus: 'PENDING', _count: { _all: 2 } },
            { rentriSyncStatus: 'FAILED', _count: { _all: 1 } },
          ]),
        },
      })
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, buildScortaRepo())

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].gravita).toBe('critico')
      expect(risultato.voci[0].dettaglio).toMatch(/3/)
      expect(risultato.voci[0].dettaglio).toMatch(/1/)
    })

    it('senza formulari da trasmettere non genera alcuna voce', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, buildScortaRepo())

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(0)
    })

    it('esclude i formulari ANNULLATI dal conteggio (un documento chiuso non va trasmesso)', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, buildScortaRepo())

      await useCase.raccogli(TENANT)

      const { where } = (prisma.db.fIR.groupBy as jest.Mock).mock.calls[0][0]
      expect(where.status.notIn).toContain('CANCELLED')
    })
  })

  describe('numeri vidimati pronti', () => {
    it('con una sede sotto la soglia configurata restituisce una voce di gravità avviso', async () => {
      const prisma = buildPrisma({
        rentriUnitaLocale: {
          findMany: jest.fn().mockResolvedValue([
            {
              numIscrSito: 'OP0001AAA000001-MI0001',
              denominazione: 'Sede di Milano',
              dimensioneScortaDesiderata: 10,
            },
          ]),
        },
      })
      const scortaRepo = buildScortaRepo({ contaTotaleDisponibili: jest.fn().mockResolvedValue(2) })
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, scortaRepo)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      const [voce] = risultato.voci
      expect(voce.gravita).toBe('avviso')
      expect(voce.titolo).toMatch(/Sede di Milano/)
      expect(voce.dettaglio).toMatch(/2/)
      expect(voce.dettaglio).toMatch(/10/)
      expect(voce.azione?.rotta).toBe('/rentri/blocchi')

      expect(scortaRepo.contaTotaleDisponibili).toHaveBeenCalledWith(
        TENANT,
        'OP0001AAA000001-MI0001'
      )
    })

    it('con una sede sopra la soglia configurata restituisce una voce di gravità informativo', async () => {
      const prisma = buildPrisma({
        rentriUnitaLocale: {
          findMany: jest.fn().mockResolvedValue([
            {
              numIscrSito: 'OP0001AAA000001-MI0001',
              denominazione: 'Sede di Milano',
              dimensioneScortaDesiderata: 10,
            },
          ]),
        },
      })
      const scortaRepo = buildScortaRepo({
        contaTotaleDisponibili: jest.fn().mockResolvedValue(25),
      })
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, scortaRepo)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].gravita).toBe('informativo')
    })

    it('senza sedi con soglia configurata non genera alcuna voce', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, buildScortaRepo())

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(0)
      expect(prisma.db.rentriUnitaLocale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT }),
        })
      )
    })
  })
})
