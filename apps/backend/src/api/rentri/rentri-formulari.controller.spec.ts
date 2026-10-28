import { Test } from '@nestjs/testing'
import { INestApplication, ExecutionContext } from '@nestjs/common'
import request from 'supertest'
import { RentriFormulariController } from './rentri-formulari.controller'
import { CercaFormulariRENTRIUseCase } from '../../application/rentri/cerca-formulari-rentri.use-case'
import { AcquisisciFormularioRENTRIUseCase } from '../../application/rentri/acquisisci-formulario-rentri.use-case'
import { RilasciaFormularioRENTRIUseCase } from '../../application/rentri/rilascia-formulario-rentri.use-case'
import { RentriUnitaLocaleService } from '../../infrastructure/rentri/rentri-unita-locale.service'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import {
  FirAnnullatoNelFrattempoError,
  FormularioGiaAgganciatoError,
} from '../../core/domain/errors'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

const user: CurrentUserPayload = {
  id: 'user-1',
  email: 'op@example.com',
  tenantId: 'tenant-1',
  role: 'OPERATOR',
  permissions: [],
}

// richiesta senza switch di azienda: l'azienda selezionata coincide con quella del token
const req = { tenantId: user.tenantId, user }
const sedePrincipale = {
  id: 'sede-1',
  numIscrSito: 'OP1234ABC123456-RM1234',
  denominazione: 'Sede principale',
  principale: true,
  attiva: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('RentriFormulariController', () => {
  let controller: RentriFormulariController
  let cercaUseCase: jest.Mocked<CercaFormulariRENTRIUseCase>
  let acquisisciUseCase: jest.Mocked<AcquisisciFormularioRENTRIUseCase>
  let rilasciaUseCase: jest.Mocked<RilasciaFormularioRENTRIUseCase>
  let unitaLocaleService: jest.Mocked<RentriUnitaLocaleService>
  let logger: LoggerService

  beforeEach(() => {
    cercaUseCase = { execute: jest.fn() } as unknown as jest.Mocked<CercaFormulariRENTRIUseCase>
    acquisisciUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<AcquisisciFormularioRENTRIUseCase>
    rilasciaUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RilasciaFormularioRENTRIUseCase>
    unitaLocaleService = {
      getPrincipale: jest.fn().mockResolvedValue(sedePrincipale),
    } as unknown as jest.Mocked<RentriUnitaLocaleService>
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as LoggerService

    controller = new RentriFormulariController(
      cercaUseCase,
      acquisisciUseCase,
      rilasciaUseCase,
      unitaLocaleService,
      logger
    )
  })

  describe('GET /rentri/formulari (cerca)', () => {
    it('ritorna il risultato della ricerca per il tenant corrente', async () => {
      const risultato = {
        risultati: [],
        paging: { page: 1, pageSize: 100, pageCount: 0, totalRecordCount: 0 },
      }
      cercaUseCase.execute.mockResolvedValue(risultato)

      const res = await controller.cerca(req)

      expect(res).toBe(risultato)
      expect(cercaUseCase.execute).toHaveBeenCalledWith('tenant-1')
    })

    it('mappa CF_TENANT_MANCANTE su 400 con il messaggio di dominio', async () => {
      cercaUseCase.execute.mockRejectedValue(
        DomainException.businessRuleViolation('CF_TENANT_MANCANTE', 'Configura il CF del tenant.')
      )

      await expect(controller.cerca(req)).rejects.toMatchObject({
        status: 400,
        message: 'Configura il CF del tenant.',
      })
    })

    it('mappa UNITA_LOCALE_MANCANTE su 400 con il messaggio tradotto (Task 7)', async () => {
      cercaUseCase.execute.mockRejectedValue(
        DomainException.businessRuleViolation('UNITA_LOCALE_MANCANTE', 'dettaglio interno ignorato')
      )

      await expect(controller.cerca(req)).rejects.toMatchObject({
        status: 400,
        message:
          'Configura il numero di iscrizione della tua unità locale nella pagina del certificato prima di cercare i formulari.',
      })
    })
  })

  describe('POST /rentri/formulari/:numeroFir/aggancia', () => {
    const dtoNuovo = { modalita: 'NUOVO' as const }
    const dtoEsistente = { modalita: 'ESISTENTE' as const, firId: 'fir-locale-1' }

    it('risolve numIscrSito dalla sede principale e aggancia come NUOVO', async () => {
      acquisisciUseCase.execute.mockResolvedValue({
        firId: 'fir-nuovo-1',
        numeroFir: 'TVXYZ1234AB',
      })

      const res = await controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req)

      expect(res).toEqual({ firId: 'fir-nuovo-1', numeroFir: 'TVXYZ1234AB' })
      expect(unitaLocaleService.getPrincipale).toHaveBeenCalledWith('tenant-1')
      expect(acquisisciUseCase.execute).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        userId: 'user-1',
        userRole: 'OPERATOR',
        numeroFir: 'TVXYZ1234AB',
        numIscrSito: 'OP1234ABC123456-RM1234',
        visibilitaGiaAcquisita: false,
        scelta: { tipo: 'NUOVO' },
        correlationId: undefined,
      })
    })

    it('aggancia come ESISTENTE passando il firId scelto', async () => {
      acquisisciUseCase.execute.mockResolvedValue({
        firId: 'fir-locale-1',
        numeroFir: 'TVXYZ1234AB',
      })

      await controller.aggancia('TVXYZ1234AB', dtoEsistente, user, req)

      expect(acquisisciUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ scelta: { tipo: 'COLLEGA_ESISTENTE', firId: 'fir-locale-1' } })
      )
    })

    it('propaga visibilitaGiaAcquisita quando indicata dal client (evita una richiesta ridondante a RENTRI)', async () => {
      acquisisciUseCase.execute.mockResolvedValue({
        firId: 'fir-nuovo-1',
        numeroFir: 'TVXYZ1234AB',
      })

      await controller.aggancia(
        'TVXYZ1234AB',
        { modalita: 'NUOVO', visibilitaGiaAcquisita: true },
        user,
        req
      )

      expect(acquisisciUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ visibilitaGiaAcquisita: true })
      )
    })

    it('risponde 400 (unità locale non configurata) PRIMA di chiamare il use case, se manca la sede', async () => {
      unitaLocaleService.getPrincipale.mockResolvedValue(null)

      await expect(controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req)).rejects.toMatchObject({
        status: 400,
      })
      expect(acquisisciUseCase.execute).not.toHaveBeenCalled()
    })

    it('mappa NOT_FOUND (FIR di un altro tenant nel ramo ESISTENTE) su 404, non 403', async () => {
      acquisisciUseCase.execute.mockRejectedValue(DomainException.notFound('FIR', 'fir-locale-1'))

      await expect(
        controller.aggancia('TVXYZ1234AB', dtoEsistente, user, req)
      ).rejects.toMatchObject({
        status: 404,
        message: 'FIR non trovato',
      })
    })

    it('mappa FORMULARIO_GIA_AGGANCIATO (precondizione applicativa) su 409, non 400', async () => {
      acquisisciUseCase.execute.mockRejectedValue(
        DomainException.businessRuleViolation(
          'FORMULARIO_GIA_AGGANCIATO',
          'Il formulario RENTRI TVXYZ1234AB è già collegato al FIR locale fir-9 di questo tenant.'
        )
      )

      await expect(controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req)).rejects.toMatchObject({
        status: 409,
        message:
          'Questo formulario è già collegato a un altro FIR nel gestionale: rilascialo da lì prima di riprovare qui.',
      })
    })

    it('mappa FIR_GIA_LEGATO (il FIR ESISTENTE scelto è già legato a un altro numero_fir) su 409', async () => {
      acquisisciUseCase.execute.mockRejectedValue(
        DomainException.businessRuleViolation(
          'FIR_GIA_LEGATO',
          'Il FIR locale fir-locale-1 è già legato al formulario RENTRI ALTRO999: rilasciare quel legame prima di agganciarne un altro.'
        )
      )

      await expect(
        controller.aggancia('TVXYZ1234AB', dtoEsistente, user, req)
      ).rejects.toMatchObject({
        status: 409,
        message:
          'Il FIR locale fir-locale-1 è già legato al formulario RENTRI ALTRO999: rilasciare quel legame prima di agganciarne un altro.',
      })
    })

    it('mai il prefisso tecnico "Business rule violated" nel messaggio esposto', async () => {
      acquisisciUseCase.execute.mockRejectedValue(
        DomainException.businessRuleViolation('FORMULARIO_GIA_AGGANCIATO', 'dettaglio interno')
      )

      try {
        await controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req)
        fail('doveva lanciare')
      } catch (error: any) {
        expect(error.message).not.toContain('Business rule violated')
      }
    })

    it('mappa il vincolo di unicità a database (FormularioGiaAgganciatoError, corsa concorrente) su 409', async () => {
      acquisisciUseCase.execute.mockRejectedValue(new FormularioGiaAgganciatoError('TVXYZ1234AB'))

      await expect(controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req)).rejects.toMatchObject({
        status: 409,
        message:
          'Questo formulario è già collegato a un altro FIR nel gestionale: rilascialo da lì prima di riprovare qui.',
      })
    })

    it('mappa il FIR annullato nel frattempo su 409 con il suo codice, non su 400', async () => {
      acquisisciUseCase.execute.mockRejectedValue(new FirAnnullatoNelFrattempoError('fir-1'))

      const errore = await controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req).catch(e => e)

      expect(errore.status).toBe(409)
      expect(errore.getResponse()).toMatchObject({
        error: 'FIR_ANNULLATO_NEL_FRATTEMPO',
        message:
          "Il FIR è stato annullato nel frattempo da un'altra operazione: ricarica la pagina per vedere lo stato aggiornato.",
      })
    })

    it('mappa NUMERO_FIR_MANCANTE su 400', async () => {
      acquisisciUseCase.execute.mockRejectedValue(
        DomainException.validationFailed('NUMERO_FIR_MANCANTE', 'Numero FIR RENTRI mancante')
      )

      await expect(controller.aggancia('', dtoNuovo, user, req)).rejects.toMatchObject({
        status: 400,
        message: 'Numero FIR RENTRI mancante',
      })
    })

    it('mappa un 403 RENTRI (non tra i soggetti coinvolti) su 403 con un messaggio distinto da RENTRI_FORBIDDEN', async () => {
      acquisisciUseCase.execute.mockRejectedValue(
        new RentriApiError(403, 'Forbidden', undefined, false)
      )

      await expect(controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req)).rejects.toMatchObject({
        status: 403,
        message:
          'Non risulti tra i soggetti coinvolti in questo formulario: RENTRI non consente di agganciarlo.',
      })
    })

    it('mappa un 429/423 RENTRI con tentativi esauriti su 503, stesso messaggio di R1', async () => {
      acquisisciUseCase.execute.mockRejectedValue(
        new RentriApiError(429, 'Too Many Requests', undefined, true)
      )

      await expect(controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req)).rejects.toMatchObject({
        status: 503,
        message:
          'RENTRI ha temporaneamente sospeso le richieste per troppi tentativi non validi: la trasmissione riprenderà da sola, senza bisogno di intervenire.',
      })
    })

    it('ri-solleva un errore non riconosciuto invariato (finisce nel GlobalExceptionFilter)', async () => {
      const inatteso = new Error('boom')
      acquisisciUseCase.execute.mockRejectedValue(inatteso)

      await expect(controller.aggancia('TVXYZ1234AB', dtoNuovo, user, req)).rejects.toBe(inatteso)
    })
  })

  describe('POST /rentri/fir/:id/rilascia-legame-rentri', () => {
    it('risolve numIscrSito e rilascia il legame', async () => {
      rilasciaUseCase.execute.mockResolvedValue({ numeroFirRilasciato: 'TVXYZ1234AB' })

      const res = await controller.rilascia('fir-1', {}, user, req)

      expect(res).toEqual({ numeroFirRilasciato: 'TVXYZ1234AB' })
      expect(rilasciaUseCase.execute).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        userId: 'user-1',
        userRole: 'OPERATOR',
        firId: 'fir-1',
        numIscrSito: 'OP1234ABC123456-RM1234',
        correlationId: undefined,
      })
    })

    it('un FIR di un altro tenant risponde 404, non 403 (convenzione P4)', async () => {
      rilasciaUseCase.execute.mockRejectedValue(DomainException.notFound('FIR', 'fir-altro-tenant'))

      await expect(controller.rilascia('fir-altro-tenant', {}, user, req)).rejects.toMatchObject({
        status: 404,
        message: 'FIR non trovato',
      })
    })

    it('mappa NESSUN_LEGAME_RENTRI su 400 (non un conflitto: non c’è nulla da rilasciare)', async () => {
      rilasciaUseCase.execute.mockRejectedValue(
        DomainException.businessRuleViolation(
          'NESSUN_LEGAME_RENTRI',
          'Nessun legame RENTRI da rilasciare per questo FIR'
        )
      )

      await expect(controller.rilascia('fir-1', {}, user, req)).rejects.toMatchObject({
        status: 400,
        message: 'Nessun legame RENTRI da rilasciare per questo FIR',
      })
    })

    it('mappa LEGAME_NON_RILASCIABILE (TRASMESSO_DA_NOI) su 400', async () => {
      rilasciaUseCase.execute.mockRejectedValue(
        DomainException.businessRuleViolation(
          'LEGAME_NON_RILASCIABILE',
          'Un formulario trasmesso da questo gestionale non si rilascia: per annullarlo usare gli endpoint del ciclo di vita RENTRI (R3)'
        )
      )

      await expect(controller.rilascia('fir-1', {}, user, req)).rejects.toMatchObject({
        status: 400,
      })
    })
  })
})

/**
 * Verifica EMPIRICA dell'autorizzazione (stesso pattern di
 * `rentri-modalita-legame.controller.spec.ts`): monta un'app Nest reale con
 * `RolesGuard` VERO (non mockato) — il 403 osservato è prodotto dal guard
 * reale che legge la metadata `@Roles`, non da un'aspettativa sul decoratore.
 */
describe('RentriFormulariController — autorizzazione (verifica empirica)', () => {
  let app: INestApplication
  let currentTestUser: CurrentUserPayload
  let cercaUseCase: jest.Mocked<CercaFormulariRENTRIUseCase>
  let acquisisciUseCase: jest.Mocked<AcquisisciFormularioRENTRIUseCase>
  let rilasciaUseCase: jest.Mocked<RilasciaFormularioRENTRIUseCase>
  let unitaLocaleService: jest.Mocked<RentriUnitaLocaleService>

  beforeAll(async () => {
    cercaUseCase = {
      execute: jest.fn().mockResolvedValue({
        risultati: [],
        paging: { page: 1, pageSize: 100, pageCount: 0, totalRecordCount: 0 },
      }),
    } as unknown as jest.Mocked<CercaFormulariRENTRIUseCase>
    acquisisciUseCase = {
      execute: jest.fn().mockResolvedValue({ firId: 'fir-1', numeroFir: 'TVXYZ1234AB' }),
    } as unknown as jest.Mocked<AcquisisciFormularioRENTRIUseCase>
    rilasciaUseCase = {
      execute: jest.fn().mockResolvedValue({ numeroFirRilasciato: 'TVXYZ1234AB' }),
    } as unknown as jest.Mocked<RilasciaFormularioRENTRIUseCase>
    unitaLocaleService = {
      getPrincipale: jest.fn().mockResolvedValue(sedePrincipale),
    } as unknown as jest.Mocked<RentriUnitaLocaleService>

    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as LoggerService

    const moduleRef = await Test.createTestingModule({
      controllers: [RentriFormulariController],
      providers: [
        { provide: CercaFormulariRENTRIUseCase, useValue: cercaUseCase },
        { provide: AcquisisciFormularioRENTRIUseCase, useValue: acquisisciUseCase },
        { provide: RilasciaFormularioRENTRIUseCase, useValue: rilasciaUseCase },
        { provide: RentriUnitaLocaleService, useValue: unitaLocaleService },
        { provide: LoggerService, useValue: logger },
        { provide: RuoloEffettivoService, useValue: { accesso: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = currentTestUser
          return true
        },
      })
      // RolesGuard NON è mockato: è il guard reale del progetto.
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('nega a un VIEWER (403) su tutti e tre gli endpoint', async () => {
    currentTestUser = {
      id: 'u',
      email: 'v@example.com',
      tenantId: 't',
      role: 'VIEWER',
      permissions: [],
    }

    await request(app.getHttpServer()).get('/rentri/formulari').expect(403)
    await request(app.getHttpServer())
      .post('/rentri/formulari/TVXYZ1234AB/aggancia')
      .send({ modalita: 'NUOVO' })
      .expect(403)
    await request(app.getHttpServer())
      .post('/rentri/fir/fir-1/rilascia-legame-rentri')
      .send({})
      .expect(403)
  })

  it('consente a un OPERATOR (200): è tra i ruoli abilitati alle scritture RENTRI', async () => {
    currentTestUser = {
      id: 'u',
      email: 'op@example.com',
      tenantId: 't',
      role: 'OPERATOR',
      permissions: [],
    }

    await request(app.getHttpServer()).get('/rentri/formulari').expect(200)
  })

  it('consente a un ADMIN (200)', async () => {
    currentTestUser = {
      id: 'u',
      email: 'a@example.com',
      tenantId: 't',
      role: 'ADMIN',
      permissions: [],
    }

    await request(app.getHttpServer()).get('/rentri/formulari').expect(200)
    await request(app.getHttpServer())
      .post('/rentri/formulari/TVXYZ1234AB/aggancia')
      .send({ modalita: 'NUOVO' })
      .expect(200)
    await request(app.getHttpServer())
      .post('/rentri/fir/fir-1/rilascia-legame-rentri')
      .send({})
      .expect(200)
  })

  it('consente a un SUPER_ADMIN (200)', async () => {
    currentTestUser = {
      id: 'u',
      email: 's@example.com',
      tenantId: 't',
      role: 'SUPER_ADMIN',
      permissions: [],
    }

    await request(app.getHttpServer()).get('/rentri/formulari').expect(200)
  })
})
