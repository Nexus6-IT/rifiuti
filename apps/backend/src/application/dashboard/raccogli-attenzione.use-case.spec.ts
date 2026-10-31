import * as fs from 'node:fs'
import * as path from 'node:path'
import { RaccogliAttenzioneUseCase } from './raccogli-attenzione.use-case'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

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

/** Percorso del router Angular, letto dal sorgente (non duplicato a mano). */
const PERCORSO_APP_ROUTES = path.join(__dirname, '../../../../frontend/src/app/app.routes.ts')

/**
 * Rotte realmente dichiarate nel router Angular. Letto dal sorgente (non
 * duplicato a mano) così che una rotta rinominata o rimossa in
 * `app.routes.ts` faccia fallire questo test invece di lasciare un
 * collegamento morto in produzione (rilievo revisione finale, 2026-09-11:
 * `/rentri/credenziali` non è mai esistita, `/impianti/...` nemmeno).
 *
 * `null` quando il file non esiste (rilievo revisione finale, 2026-09-11):
 * questa suite backend può girare in contesti dove l'albero `frontend/` non
 * è presente accanto a `backend/` (es. backend testato da solo, checkout
 * parziale in CI). In quel caso il test che usa questa funzione deve
 * saltare con un messaggio esplicito, non fallire con un `ENOENT` che non
 * dice nulla sull'intento del controllo.
 */
function percorsiDichiaratiFrontend(): Set<string> | null {
  if (!fs.existsSync(PERCORSO_APP_ROUTES)) {
    return null
  }
  const contenuto = fs.readFileSync(PERCORSO_APP_ROUTES, 'utf-8')
  const percorsi = new Set<string>()
  const regex = /path:\s*'([^']*)'/g
  let corrispondenza: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((corrispondenza = regex.exec(contenuto))) {
    percorsi.add(corrispondenza[1])
  }
  return percorsi
}

/**
 * Vero se `rotta` (es. `/rentri/certificato` o `/impianti/x/uuid-1`)
 * corrisponde a un `path` dichiarato: match esatto sul percorso senza lo
 * slash iniziale, oppure — per una rotta di dettaglio con un id in coda —
 * match sostituendo l'ultimo segmento con `:id`.
 */
function rottaDichiarata(rotta: string, percorsi: Set<string>): boolean {
  const senzaSlash = rotta.replace(/^\//, '')
  if (percorsi.has(senzaSlash)) {
    return true
  }
  const segmenti = senzaSlash.split('/')
  const conSegnaposto = [...segmenti.slice(0, -1), ':id'].join('/')
  return percorsi.has(conSegnaposto)
}

// L'use case legge tutti i model dal client esteso `this.prisma.db.<model>`
// (difesa in profondità RLS, rilievo revisione finale 2026-09-11), non dal
// client nudo: il mock riproduce quella forma, non `prisma.<model>` diretto.
function buildPrisma(overrides: any = {}): PrismaService {
  return {
    db: {
      rentriCredential: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      autorizzazioneImpianto: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      trasportatore: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      destinatario: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides,
    },
  } as unknown as PrismaService
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
      expect(voce.azione?.rotta).toBe('/rentri/certificato')

      expect(prisma.db.rentriCredential.findUnique).toHaveBeenCalledWith(
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
      // Non esiste alcuna pagina di dettaglio autorizzazione impianto
      // nell'app frontend (`app.routes.ts`): un collegamento inventato è
      // peggio di nessun collegamento, quindi `azione` resta assente.
      expect(risultato.voci[0].azione).toBeUndefined()

      expect(prisma.db.autorizzazioneImpianto.findMany).toHaveBeenCalledWith(
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

  describe('iscrizione Albo Gestori del trasportatore', () => {
    it("con un'iscrizione in scadenza restituisce una voce trasportatore-iscrizione di gravità avviso con la rotta verso l'elenco trasportatori", async () => {
      const scadenzaIscrizione = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        trasportatore: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'tra-1', ditta: { ragioneSociale: 'Trasporti Rossi SRL' }, scadenzaIscrizione },
            ]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].chiave).toBe('trasportatore-iscrizione')
      expect(risultato.voci[0].gravita).toBe('avviso')
      expect(risultato.voci[0].titolo).toMatch(/Trasporti Rossi SRL/)
      expect(risultato.voci[0].azione?.rotta).toBe('/trasportatori')

      expect(prisma.db.trasportatore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT }),
        })
      )
    })

    it('mostra il nome attuale della ditta e la include nella lettura (D10)', async () => {
      const scadenzaIscrizione = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        trasportatore: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'tra-1',
              ditta: { ragioneSociale: 'Nome Nuovo SRL' },
              scadenzaIscrizione,
            },
          ]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci[0].titolo).toMatch(/Nome Nuovo SRL/)
      expect(prisma.db.trasportatore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: { ditta: { select: { ragioneSociale: true } } } })
      )
    })

    it("con un'iscrizione scaduta restituisce gravità critico", async () => {
      const scadenzaIscrizione = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        trasportatore: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'tra-1', ditta: { ragioneSociale: 'Trasporti Rossi SRL' }, scadenzaIscrizione },
            ]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].gravita).toBe('critico')
    })

    it('senza scadenza valorizzata non genera alcuna voce (assenza del dato non è "scaduta")', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(0)
    })
  })

  describe('autorizzazione del destinatario', () => {
    it("con un'autorizzazione in scadenza restituisce una voce destinatario-autorizzazione di gravità avviso con la rotta verso l'elenco destinatari", async () => {
      const scadenzaAutorizzazione = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        destinatario: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'des-1',
              ditta: { ragioneSociale: 'Impianto Bianchi SPA' },
              scadenzaAutorizzazione,
            },
          ]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].chiave).toBe('destinatario-autorizzazione')
      expect(risultato.voci[0].gravita).toBe('avviso')
      expect(risultato.voci[0].titolo).toMatch(/Impianto Bianchi SPA/)
      expect(risultato.voci[0].azione?.rotta).toBe('/destinatari')

      expect(prisma.db.destinatario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT }),
        })
      )
    })

    it("con un'autorizzazione scaduta restituisce gravità critico", async () => {
      const scadenzaAutorizzazione = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        destinatario: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'des-1',
              ditta: { ragioneSociale: 'Impianto Bianchi SPA' },
              scadenzaAutorizzazione,
            },
          ]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(1)
      expect(risultato.voci[0].gravita).toBe('critico')
    })

    it('senza scadenza valorizzata non genera alcuna voce (assenza del dato non è "scaduta")', async () => {
      const prisma = buildPrisma()
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)

      expect(risultato.voci).toHaveLength(0)
    })
  })

  describe('integrità dei collegamenti (azione.rotta)', () => {
    it('ogni azione prodotta da tutte le fonti punta a una rotta realmente dichiarata in app.routes.ts', async () => {
      ;(X509Certificate as jest.Mock).mockImplementation(() => ({
        validTo: validToFraGiorni(12),
      }))
      const scaduta = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const prisma = buildPrisma({
        rentriCredential: {
          findUnique: jest.fn().mockResolvedValue({ certificatePem: 'PEM-FINTO' }),
        },
        autorizzazioneImpianto: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'aut-1', estremi: 'AUT/2026/001', dataScadenza: scaduta }]),
        },
        trasportatore: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'tra-1',
              ditta: { ragioneSociale: 'Trasporti Rossi SRL' },
              scadenzaIscrizione: scaduta,
            },
          ]),
        },
        destinatario: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'des-1',
              ditta: { ragioneSociale: 'Impianto Bianchi SPA' },
              scadenzaAutorizzazione: scaduta,
            },
          ]),
        },
      })
      const useCase = new RaccogliAttenzioneUseCase(prisma)

      const risultato = await useCase.raccogli(TENANT)
      const percorsi = percorsiDichiaratiFrontend()
      if (percorsi === null) {
        // eslint-disable-next-line no-console
        console.warn(
          `[skip] "${PERCORSO_APP_ROUTES}" non trovato: albero frontend assente in ` +
            'questo contesto di esecuzione, impossibile verificare i collegamenti contro le rotte reali.'
        )
        return
      }
      const azioniConRotta = risultato.voci.filter(voce => voce.azione)

      // Almeno una voce con azione deve essere stata effettivamente prodotta
      // dal fixture, altrimenti il test passerebbe senza aver verificato nulla.
      expect(azioniConRotta.length).toBeGreaterThan(0)

      for (const voce of azioniConRotta) {
        expect(rottaDichiarata(voce.azione!.rotta, percorsi)).toBe(true)
      }

      // L'autorizzazione impianto non ha una pagina di dettaglio dedicata:
      // deve restare senza azione, mai un collegamento inventato.
      const voceAutorizzazione = risultato.voci.find(voce => voce.chiave === 'autorizzazione')
      expect(voceAutorizzazione?.azione).toBeUndefined()
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
