import { RaccogliIndicatoriAzioneUseCase } from './raccogli-indicatori-azione.use-case'

const TENANT = 'tenant-uuid-001'

function buildPrisma(overrides: any = {}) {
  return {
    fIR: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    rentriUnitaLocale: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  }
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

      expect(prisma.fIR.groupBy).toHaveBeenCalledWith(
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
      expect(prisma.rentriUnitaLocale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT }),
        })
      )
    })
  })
})
