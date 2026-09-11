import { RaccogliAttenzioneUseCase } from './raccogli-attenzione.use-case'

// Stesso pattern di `rentri-certificato-scadenza.job.spec.ts`: generare un
// vero certificato X.509 firmato richiederebbe OpenSSL o una libreria
// esterna non disponibile in questo ambiente Jest — si mocka direttamente
// `X509Certificate` (il codice condiviso lo invoca solo per leggere
// `.validTo`), pilotando la sola data che il calcolo usa.
jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto')
  return {
    ...actual,
    X509Certificate: jest.fn(),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { X509Certificate } = require('node:crypto')

const TENANT = 'tenant-uuid-001'

function validToFraGiorni(giorni: number): string {
  // + 12 ore di margine per evitare che l'arrotondamento del calcolo
  // condiviso (Math.floor) faccia scivolare il risultato di un giorno
  // per via del tempo di esecuzione del test.
  return new Date(Date.now() + giorni * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000).toUTCString()
}

function buildPrisma(overrides: any = {}) {
  return {
    rentriCredential: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    autorizzazioneImpianto: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  }
}

describe('RaccogliAttenzioneUseCase', () => {
  beforeEach(() => {
    ;(X509Certificate as jest.Mock).mockReset()
  })

  describe('certificato RENTRI', () => {
    it('con un certificato in scadenza fra 12 giorni restituisce una voce certificato-rentri di gravità avviso con la rotta verso la pagina del certificato', async () => {
      ;(X509Certificate as jest.Mock).mockImplementation(() => ({
        validTo: validToFraGiorni(12),
      }))
      const prisma = buildPrisma({
        rentriCredential: {
          findUnique: jest.fn().mockResolvedValue({ certificatePem: 'PEM-FINTO' }),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      const [voce] = risultato.voci
      expect(voce.chiave).toBe('certificato-rentri')
      expect(voce.gravita).toBe('avviso')
      expect(voce.dettaglio).toMatch(/12/)
      expect(voce.azione).toBeDefined()
      expect(voce.azione?.rotta).toBe('/rentri/credenziali')

      expect(prisma.rentriCredential.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT } })
      )
    })

    it('con un certificato scaduto restituisce gravità critico', async () => {
      ;(X509Certificate as jest.Mock).mockImplementation(() => ({
        validTo: validToFraGiorni(-5),
      }))
      const prisma = buildPrisma({
        rentriCredential: {
          findUnique: jest.fn().mockResolvedValue({ certificatePem: 'PEM-FINTO' }),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].gravita).toBe('critico')
    })

    it("con un certificato non analizzabile restituisce comunque una voce di gravità critico (null non è un'assenza di problema)", async () => {
      ;(X509Certificate as jest.Mock).mockImplementation(() => {
        throw new Error('formato non valido')
      })
      const prisma = buildPrisma({
        rentriCredential: {
          findUnique: jest.fn().mockResolvedValue({ certificatePem: 'PEM-CORROTTO' }),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].chiave).toBe('certificato-rentri')
      expect(risultato.voci[0].gravita).toBe('critico')
    })

    it('senza credenziali RENTRI configurate non genera alcuna voce', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(0)
    })

    it('con un certificato lontano dalla scadenza (oltre soglia) non genera alcuna voce', async () => {
      ;(X509Certificate as jest.Mock).mockImplementation(() => ({
        validTo: validToFraGiorni(200),
      }))
      const prisma = buildPrisma({
        rentriCredential: {
          findUnique: jest.fn().mockResolvedValue({ certificatePem: 'PEM-FINTO' }),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(0)
    })
  })

  describe('autorizzazioni impianto', () => {
    it("con un'autorizzazione in scadenza restituisce una voce di gravità avviso con la rotta verso l'autorizzazione", async () => {
      const dataScadenza = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        autorizzazioneImpianto: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'aut-1', estremi: 'AUT/2026/001', dataScadenza }]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].chiave).toBe('autorizzazione')
      expect(risultato.voci[0].gravita).toBe('avviso')
      expect(risultato.voci[0].azione?.rotta).toBe('/impianti/autorizzazioni/aut-1')

      expect(prisma.autorizzazioneImpianto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT }),
        })
      )
    })

    it("con un'autorizzazione scaduta restituisce gravità critico", async () => {
      const dataScadenza = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        autorizzazioneImpianto: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'aut-1', estremi: 'AUT/2026/001', dataScadenza }]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].gravita).toBe('critico')
    })
  })

  describe('ordinamento', () => {
    it('restituisce le voci ordinate per gravità, i critici per primi', async () => {
      ;(X509Certificate as jest.Mock).mockImplementation(() => ({
        validTo: validToFraGiorni(12),
      }))
      const dataScadenza = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        rentriCredential: {
          // avviso (12 giorni)
          findUnique: jest.fn().mockResolvedValue({ certificatePem: 'PEM-FINTO' }),
        },
        autorizzazioneImpianto: {
          // critico (scaduta)
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'aut-1', estremi: 'AUT/2026/001', dataScadenza }]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(2)
      expect(risultato.voci[0].gravita).toBe('critico')
      expect(risultato.voci[1].gravita).toBe('avviso')
    })
  })
})
