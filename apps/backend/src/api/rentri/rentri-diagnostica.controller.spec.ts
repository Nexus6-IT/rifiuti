import { Test } from '@nestjs/testing'
import { RentriDiagnosticaController } from './rentri-diagnostica.controller'
import {
  GetRentriDiagnosticaUseCase,
  RentriDiagnostica,
} from '../../application/rentri/get-rentri-diagnostica.use-case'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import { RentriRateLimiterService } from '../../infrastructure/rentri/rentri-rate-limiter.service'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

const user: CurrentUserPayload = {
  id: 'user-1',
  email: 'operator@example.com',
  tenantId: 'tenant-1',
  role: 'OPERATOR',
  permissions: [],
}

function diagnosticaFinta(overrides: Partial<RentriDiagnostica> = {}): RentriDiagnostica {
  return {
    certificato: {
      configurato: true,
      scadenza: '2027-01-01T00:00:00.000Z',
      giorniAllaScadenza: 100,
      livelloAvviso: 'ok',
    },
    trasmissioniRecenti: [],
    formulariAttenzione: [],
    limitatore: { volumeCorrente: 0, concorrenzaCorrente: 0, inAttesa: false },
    ...overrides,
  }
}

/**
 * Proprietà lette dal FRAMEWORK per ragioni proprie (Nest DI verifica se
 * l'istanza risolta da `useFactory` è un thenable leggendo `.then`; Jest e
 * Node possono leggere `constructor`/`toJSON`/simboli ben noti per
 * introspezione) — leggerle non significa che l'APPLICAZIONE stia usando il
 * client verso RENTRI, quindi non deve far fallire il test.
 */
const PROPRIETA_IGNORATE_DAL_FRAMEWORK = new Set<string | symbol>([
  'then',
  'catch',
  'finally',
  'constructor',
  'toJSON',
  'inspect',
  'name',
  'length',
  Symbol.toStringTag,
  Symbol.toPrimitive,
  Symbol.iterator,
])

/**
 * Un `RENTRIApiClient` che fa fallire il test se un metodo APPLICATIVO
 * (qualunque proprietà diversa da quelle sopra) viene letto o invocato: il
 * percorso di diagnostica non deve mai raggiungere l'infrastruttura verso
 * RENTRI.
 */
function creaRentriApiClientCheFallisceSeToccato(): RENTRIApiClient {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (PROPRIETA_IGNORATE_DAL_FRAMEWORK.has(prop)) {
          return undefined
        }
        throw new Error(
          `RENTRIApiClient.${String(prop)} è stato toccato dal percorso di diagnostica: ` +
            'la diagnostica deve usare SOLO dati già raccolti localmente, mai una chiamata verso RENTRI.'
        )
      },
    }
  ) as RENTRIApiClient
}

describe('RentriDiagnosticaController', () => {
  describe('unità — use case mockato', () => {
    let controller: RentriDiagnosticaController
    let useCase: jest.Mocked<GetRentriDiagnosticaUseCase>

    beforeEach(() => {
      useCase = { execute: jest.fn() } as unknown as jest.Mocked<GetRentriDiagnosticaUseCase>
      controller = new RentriDiagnosticaController(useCase)
    })

    it("passa il tenantId dell'utente corrente, mai un id preso da altrove", async () => {
      useCase.execute.mockResolvedValue(diagnosticaFinta())

      await controller.diagnostica(user)

      expect(useCase.execute).toHaveBeenCalledWith('tenant-1')
      expect(useCase.execute).toHaveBeenCalledTimes(1)
    })

    it('restituisce esattamente il risultato del use case, senza post-elaborazione che potrebbe nascondere un campo', async () => {
      const risultato = diagnosticaFinta({
        formulariAttenzione: [
          {
            firId: 'fir-1',
            firNumber: 'FIR-0001',
            motivo: 'PERMANENTLY_FAILED',
            dettaglio: 'errore',
          },
        ],
      })
      useCase.execute.mockResolvedValue(risultato)

      const esito = await controller.diagnostica(user)

      expect(esito).toEqual(risultato)
    })

    it('un tenant diverso richiede sempre e solo il proprio tenantId (isolamento)', async () => {
      useCase.execute.mockResolvedValue(diagnosticaFinta())
      const altroUtente: CurrentUserPayload = { ...user, tenantId: 'tenant-2' }

      await controller.diagnostica(altroUtente)

      expect(useCase.execute).toHaveBeenCalledWith('tenant-2')
      expect(useCase.execute).not.toHaveBeenCalledWith('tenant-1')
    })
  })

  describe('nessuna chiamata verso RENTRI (Step 4 del piano — il test che conta)', () => {
    it(
      'anche con un RENTRIApiClient reale nel container, il percorso completo ' +
        'controller→use case non lo tocca mai: un client "avvelenato" che ' +
        'lancia al primo accesso NON causa alcun fallimento',
      async () => {
        const prisma = {
          rENTRISyncLog: { findMany: jest.fn().mockResolvedValue([]) },
          fIR: { findMany: jest.fn().mockResolvedValue([]) },
        }
        const credentialService = { getForTenant: jest.fn().mockResolvedValue(null) }
        const rateLimiter = {
          statoAttuale: jest
            .fn()
            .mockResolvedValue({ volumeCorrente: 0, concorrenzaCorrente: 0, inAttesa: false }),
        }

        const moduleRef = await Test.createTestingModule({
          controllers: [RentriDiagnosticaController],
          providers: [
            GetRentriDiagnosticaUseCase,
            { provide: PrismaService, useValue: prisma },
            { provide: RentriCredentialService, useValue: credentialService },
            { provide: RentriRateLimiterService, useValue: rateLimiter },
            // Presente nel container (come lo sarebbe in RentriModule reale),
            // ma MAI iniettato in GetRentriDiagnosticaUseCase: se qualcosa lo
            // toccasse comunque, questo provider lancerebbe immediatamente.
            { provide: RENTRIApiClient, useFactory: creaRentriApiClientCheFallisceSeToccato },
          ],
        }).compile()

        const controller = moduleRef.get(RentriDiagnosticaController)

        await expect(controller.diagnostica(user)).resolves.toEqual(
          expect.objectContaining({
            certificato: expect.objectContaining({ configurato: false }),
          })
        )

        // Nessuna delle chiamate locali ha innescato una richiesta all'ente.
        expect(prisma.rENTRISyncLog.findMany).toHaveBeenCalled()
        expect(prisma.fIR.findMany).toHaveBeenCalled()
        expect(rateLimiter.statoAttuale).toHaveBeenCalled()
      }
    )
  })
})
