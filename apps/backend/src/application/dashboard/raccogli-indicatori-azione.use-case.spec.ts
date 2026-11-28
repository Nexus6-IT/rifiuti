import { RaccogliIndicatoriAzioneUseCase } from './raccogli-indicatori-azione.use-case'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { FEATURE_KEYS } from '../admin/feature-catalog'

const TUTTI_I_MODULI = new Set(FEATURE_KEYS)

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

const SEDE = 'OP0001AAA000001-MI0001'
/** Sorgente del consumo: di default AUTOMATICA con `SEDE` come principale. */
function buildSorgente(consumo: { numIscrSito: string } | null = { numIscrSito: SEDE }) {
  return { perTenant: jest.fn().mockResolvedValue(consumo) } as any
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
      const useCase = new RaccogliIndicatoriAzioneUseCase(
        prisma,
        buildScortaRepo(),
        buildSorgente()
      )

      const risultato = await useCase.raccogli(TENANT, TUTTI_I_MODULI)

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
      const useCase = new RaccogliIndicatoriAzioneUseCase(
        prisma,
        buildScortaRepo(),
        buildSorgente()
      )

      const risultato = await useCase.raccogli(TENANT, TUTTI_I_MODULI)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].gravita).toBe('critico')
      expect(risultato.voci[0].dettaglio).toMatch(/3/)
      expect(risultato.voci[0].dettaglio).toMatch(/1/)
    })

    it('senza formulari da trasmettere non genera alcuna voce', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliIndicatoriAzioneUseCase(
        prisma,
        buildScortaRepo(),
        buildSorgente()
      )

      const risultato = await useCase.raccogli(TENANT, TUTTI_I_MODULI)

      expect(risultato.voci).toHaveLength(0)
    })

    it('esclude i formulari ANNULLATI dal conteggio (un documento chiuso non va trasmesso)', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliIndicatoriAzioneUseCase(
        prisma,
        buildScortaRepo(),
        buildSorgente()
      )

      await useCase.raccogli(TENANT, TUTTI_I_MODULI)

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
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, scortaRepo, buildSorgente())

      const risultato = await useCase.raccogli(TENANT, TUTTI_I_MODULI)

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

    it('con la scorta ESAURITA (0 disponibili) la gravità è critico: a quel punto non si emette più', async () => {
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
      const scortaRepo = buildScortaRepo({ contaTotaleDisponibili: jest.fn().mockResolvedValue(0) })
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, scortaRepo, buildSorgente())

      const risultato = await useCase.raccogli(TENANT, TUTTI_I_MODULI)

      const [voce] = risultato.voci
      expect(voce.gravita).toBe('critico')
      expect(voce.titolo).toMatch(/esaurit/i)
      expect(voce.titolo).toMatch(/Sede di Milano/)
      expect(voce.azione?.rotta).toBe('/rentri/blocchi')
    })

    it.each([
      ['emissione che non consuma scorta (MANUALE, senza certificato...)', null],
      ['sede diversa da quella da cui si consuma (non principale)', { numIscrSito: 'ALTRA-SEDE' }],
    ])('scorta a zero con %s: avviso, mai critico', async (_nome, consumo) => {
      const prisma = buildPrisma({
        rentriUnitaLocale: {
          findMany: jest.fn().mockResolvedValue([
            {
              numIscrSito: SEDE,
              denominazione: 'Sede di Milano',
              dimensioneScortaDesiderata: 10,
            },
          ]),
        },
      })
      const useCase = new RaccogliIndicatoriAzioneUseCase(
        prisma,
        buildScortaRepo({ contaTotaleDisponibili: jest.fn().mockResolvedValue(0) }),
        buildSorgente(consumo)
      )

      const risultato = await useCase.raccogli(TENANT, TUTTI_I_MODULI)

      expect(risultato.voci[0].gravita).toBe('avviso')
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
      const useCase = new RaccogliIndicatoriAzioneUseCase(prisma, scortaRepo, buildSorgente())

      const risultato = await useCase.raccogli(TENANT, TUTTI_I_MODULI)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].gravita).toBe('informativo')
    })

    it('senza sedi con soglia configurata non genera alcuna voce', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliIndicatoriAzioneUseCase(
        prisma,
        buildScortaRepo(),
        buildSorgente()
      )

      const risultato = await useCase.raccogli(TENANT, TUTTI_I_MODULI)

      expect(risultato.voci).toHaveLength(0)
      expect(prisma.db.rentriUnitaLocale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT }),
        })
      )
    })
  })
})
