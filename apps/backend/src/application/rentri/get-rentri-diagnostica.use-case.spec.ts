import {
  GetRentriDiagnosticaUseCase,
  RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI,
  RENTRI_DIAGNOSTICA_TRASMISSIONI_LIMITE,
} from './get-rentri-diagnostica.use-case'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import { RentriRateLimiterService } from '../../infrastructure/rentri/rentri-rate-limiter.service'

// Generare un vero certificato X.509 firmato richiederebbe OpenSSL o una
// libreria esterna non disponibile in questo ambiente Jest: si mocka
// direttamente `X509Certificate` (il costruttore dell'use case lo invoca
// solo per leggere `.validTo`), pilotando la sola data che il codice usa.
jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto')
  return {
    ...actual,
    X509Certificate: jest.fn(),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { X509Certificate } = require('node:crypto')

describe('GetRentriDiagnosticaUseCase', () => {
  let prisma: {
    rENTRISyncLog: { findMany: jest.Mock }
    fIR: { findMany: jest.Mock }
  }
  let credentialService: { getForTenant: jest.Mock }
  let rateLimiter: { statoAttuale: jest.Mock }
  let useCase: GetRentriDiagnosticaUseCase
  let config: any

  beforeEach(() => {
    prisma = {
      rENTRISyncLog: { findMany: jest.fn().mockResolvedValue([]) },
      fIR: { findMany: jest.fn().mockResolvedValue([]) },
    }
    credentialService = { getForTenant: jest.fn().mockResolvedValue(null) }
    rateLimiter = {
      statoAttuale: jest.fn().mockResolvedValue({
        volumeCorrente: 0,
        concorrenzaCorrente: 0,
        inAttesa: false,
      }),
    }

    config = { certificatePem: 'ENV-CERT', privateKeyPem: 'ENV-KEY', envTenantId: 'tenant-pilota' }
    useCase = new GetRentriDiagnosticaUseCase(
      prisma as unknown as PrismaService,
      credentialService as unknown as RentriCredentialService,
      rateLimiter as unknown as RentriRateLimiterService,
      config
    )
    ;(X509Certificate as jest.Mock).mockReset()
  })

  describe('nessuna chiamata verso RENTRI (vincolo che decide il task)', () => {
    it('non importa/usa RENTRIApiClient: il costruttore accetta solo Prisma, credenziali, limitatore e config (sola lettura)', () => {
      // Verifica strutturale: se in futuro qualcuno aggiungesse RENTRIApiClient
      // come quarta dipendenza, questo test andrebbe aggiornato ESPLICITAMENTE
      // — non può succedere per errore silenzioso, perché il costruttore ha
      // arità fissa verificata qui.
      expect(GetRentriDiagnosticaUseCase.length).toBe(4)
    })

    it('esegue query esclusivamente locali (Prisma, credenziali, Redis) e produce un risultato coerente', async () => {
      const risultato = await useCase.execute('tenant-1')

      expect(prisma.rENTRISyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } })
      )
      expect(prisma.fIR.findMany).toHaveBeenCalled()
      expect(credentialService.getForTenant).toHaveBeenCalledWith('tenant-1')
      expect(rateLimiter.statoAttuale).toHaveBeenCalledWith('tenant-1')
      expect(risultato.limitatore).toEqual({
        volumeCorrente: 0,
        concorrenzaCorrente: 0,
        inAttesa: false,
      })
    })
  })

  describe('certificato — soglie IDENTICHE a DeadlineCheckerService (30/15/7)', () => {
    it('non configurato: livelloAvviso "ok", nessun dato di scadenza', async () => {
      credentialService.getForTenant.mockResolvedValue(null)

      const { certificato } = await useCase.execute('tenant-1')

      expect(certificato).toEqual({
        configurato: false,
        scadenza: null,
        giorniAllaScadenza: null,
        livelloAvviso: 'ok',
        origineCredenziale: 'nessuna',
      })
    })

    it('origine della credenziale: tenant se ha la propria, env se è il tenant legato, altrimenti nessuna', async () => {
      credentialService.getForTenant.mockResolvedValue(null)
      expect((await useCase.execute('tenant-pilota')).certificato.origineCredenziale).toBe('env')
      expect((await useCase.execute('tenant-altro')).certificato.origineCredenziale).toBe('nessuna')

      config.envTenantId = undefined
      expect((await useCase.execute('tenant-pilota')).certificato.origineCredenziale).toBe('nessuna')

      credentialService.getForTenant.mockResolvedValue({
        clientId: 'c',
        certificatePem: 'PEM-FINTO',
        privateKeyPem: 'K',
      })
      ;(X509Certificate as jest.Mock).mockImplementation(() => ({
        validTo: new Date(Date.now() + 100 * 86400000).toUTCString(),
      }))
      expect((await useCase.execute('tenant-altro')).certificato.origineCredenziale).toBe('tenant')
    })

    function conScadenzaTraGiorni(giorni: number): void {
      credentialService.getForTenant.mockResolvedValue({
        clientId: 'client-1',
        certificatePem: 'PEM-FINTO',
        privateKeyPem: 'KEY-FINTA',
        algorithm: 'RS256',
        environment: 'demo',
      })
      // Margine di sicurezza (+12h): senza di esso un valore "esatto" (es.
      // 31 giorni) può, per la latenza reale tra questo calcolo e
      // `Date.now()` letto dentro `leggiCertificato`, arrotondare per
      // difetto (`Math.floor`) al giorno precedente e cadere nel bucket
      // sbagliato — un flake da timing, non un errore di logica.
      const validTo = new Date(Date.now() + giorni * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000)
      ;(X509Certificate as jest.Mock).mockImplementation(() => ({
        validTo: validTo.toUTCString(),
      }))
    }

    it('31 giorni alla scadenza: livelloAvviso "ok" (fuori soglia)', async () => {
      conScadenzaTraGiorni(31)
      const { certificato } = await useCase.execute('tenant-1')
      expect(certificato.livelloAvviso).toBe('ok')
      expect(certificato.configurato).toBe(true)
    })

    it(`${RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_30} giorni: livelloAvviso "avviso_30"`, async () => {
      conScadenzaTraGiorni(RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_30)
      const { certificato } = await useCase.execute('tenant-1')
      expect(certificato.livelloAvviso).toBe('avviso_30')
    })

    it(`${RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_15} giorni: livelloAvviso "avviso_15"`, async () => {
      conScadenzaTraGiorni(RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_15)
      const { certificato } = await useCase.execute('tenant-1')
      expect(certificato.livelloAvviso).toBe('avviso_15')
    })

    it(`${RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_7} giorni: livelloAvviso "avviso_7"`, async () => {
      conScadenzaTraGiorni(RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_7)
      const { certificato } = await useCase.execute('tenant-1')
      expect(certificato.livelloAvviso).toBe('avviso_7')
    })

    it('scadenza già passata: livelloAvviso "scaduto"', async () => {
      conScadenzaTraGiorni(-1)
      const { certificato } = await useCase.execute('tenant-1')
      expect(certificato.livelloAvviso).toBe('scaduto')
      expect(certificato.giorniAllaScadenza).toBeLessThan(0)
    })

    it('le soglie sono ESATTAMENTE 30/15/7 (identiche a DeadlineCheckerService, non re-inventate)', () => {
      expect(RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI).toEqual({
        AVVISO_30: 30,
        AVVISO_15: 15,
        AVVISO_7: 7,
      })
    })
  })

  describe("trasmissioni recenti — da RENTRISyncLog, mai una nuova interrogazione dell'ente", () => {
    it('limita il risultato a RENTRI_DIAGNOSTICA_TRASMISSIONI_LIMITE elementi (richiesto a Prisma via take)', async () => {
      await useCase.execute('tenant-1')

      expect(prisma.rENTRISyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: RENTRI_DIAGNOSTICA_TRASMISSIONI_LIMITE })
      )
    })

    it('mappa i campi del log, incluso il numero FIR tramite la relazione', async () => {
      prisma.rENTRISyncLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          firId: 'fir-1',
          status: 'SUCCESS',
          attempt: 1,
          errorCode: null,
          errorMessage: null,
          createdAt: new Date('2026-07-26T10:00:00.000Z'),
          fir: { firNumber: 'FIR-0001' },
        },
      ])

      const { trasmissioniRecenti } = await useCase.execute('tenant-1')

      expect(trasmissioniRecenti).toEqual([
        {
          id: 'log-1',
          firId: 'fir-1',
          firNumber: 'FIR-0001',
          status: 'SUCCESS',
          attempt: 1,
          errorCode: null,
          errorMessage: null,
          createdAt: '2026-07-26T10:00:00.000Z',
        },
      ])
    })
  })

  describe('formulari che richiedono attenzione — query locale sui FIR del tenant', () => {
    it('include i FIR PERMANENTLY_FAILED con il messaggio di errore', async () => {
      prisma.fIR.findMany
        .mockResolvedValueOnce([
          { id: 'fir-1', firNumber: 'FIR-0001', rentriLastSyncError: 'validazione fallita' },
        ])
        .mockResolvedValueOnce([])

      const { formulariAttenzione } = await useCase.execute('tenant-1')

      expect(formulariAttenzione).toEqual([
        {
          firId: 'fir-1',
          firNumber: 'FIR-0001',
          motivo: 'PERMANENTLY_FAILED',
          dettaglio: 'validazione fallita',
        },
      ])
    })

    it('include i FIR in attesa di conferma legame (rentriNumeroFirProposto valorizzato)', async () => {
      prisma.fIR.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'fir-2', firNumber: 'FIR-0002', rentriNumeroFirProposto: 'TVXYZ1234AB' },
        ])

      const { formulariAttenzione } = await useCase.execute('tenant-1')

      expect(formulariAttenzione).toEqual([
        {
          firId: 'fir-2',
          firNumber: 'FIR-0002',
          motivo: 'ATTESA_CONFERMA_LEGAME',
          dettaglio:
            "RENTRI ha proposto il numero formulario TVXYZ1234AB: in attesa che un operatore confermi l'aggancio.",
        },
      ])
    })

    it('filtra sempre per tenantId — mai un formulario di un altro tenant', async () => {
      await useCase.execute('tenant-isolato')

      const chiamate = prisma.fIR.findMany.mock.calls
      for (const [args] of chiamate) {
        expect(args.where.tenantId).toBe('tenant-isolato')
      }
    })
  })

  describe('limitatore — stato riportato da RentriRateLimiterService.statoAttuale', () => {
    it('propaga inAttesa=true quando il tenant sta attualmente attendendo capacità', async () => {
      rateLimiter.statoAttuale.mockResolvedValue({
        volumeCorrente: 30,
        concorrenzaCorrente: 1,
        inAttesa: true,
      })

      const { limitatore } = await useCase.execute('tenant-1')

      expect(limitatore.inAttesa).toBe(true)
    })
  })
})
