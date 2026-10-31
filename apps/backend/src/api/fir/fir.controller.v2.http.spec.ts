/**
 * PUT /fir/:id attraverso la catena HTTP reale: JwtAuthGuard (finto) → TenantSwitchInterceptor
 * globale → ValidationPipe (come main.ts) → FIRControllerV2 → filtro globale delle eccezioni.
 * Il caso d'uso e' finto ma lancia gli errori di dominio veri: si verifica che il controller li
 * lasci passare al filtro (409/404) e che i corpi di errore non contengano id di tenant.
 */

import { Test } from '@nestjs/testing'
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { FIRControllerV2 } from './fir.controller.v2'
import { CreateFIRUseCase } from '../../application/fir/use-cases/create-fir.use-case'
import { EmettiFIRUseCase } from '../../application/fir/use-cases/emetti-fir.use-case'
import { PresaInCaricoFIRUseCase } from '../../application/fir/use-cases/presa-in-carico-fir.use-case'
import { CollegamentiAccessoService } from '../../application/pese/collegamenti-accesso.service'
import {
  CollegamentoNonValidoError,
  StatoAccessoNonValidoError,
} from '../../application/pese/errori-pese'
import { ConfermaConsegnaFIRUseCase } from '../../application/fir/use-cases/conferma-consegna-fir.use-case'
import { AnnullaFIRUseCase } from '../../application/fir/use-cases/annulla-fir.use-case'
import { ModificaFIRUseCase } from '../../application/fir/use-cases/modifica-fir.use-case'
import { GetFIRByIdQueryHandler } from '../../application/fir/queries/get-fir-by-id.handler'
import { ListFIRsQueryHandler } from '../../application/fir/queries/list-firs.handler'
import { SubscriptionEnforcementService } from '../../application/billing/subscription-enforcement.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MembershipService } from '../me/membership.service'
import { TenantSwitchInterceptor } from '../../core/interceptors/tenant-switch.interceptor'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Result } from '../../core/application/result'
import {
  FirModificatoNelFrattempoError,
  FirNonModificabileError,
  FirNonTrovatoError,
} from '../../core/domain/errors'
import { FIR, ProvenienzaRifiuto, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'

const STUDIO = '5a5a5a5a-0000-4000-8000-000000000001'
const CLIENTE = 'c1c1c1c1-0000-4000-8000-000000000002'
const CONSULENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const FIR_ID = '7e7e7e7e-0000-4000-8000-000000000004'

/** Prisma finto: una sola associazione del consulente al cliente, con il ruolo indicato. */
function prismaFinto(ruoloAssociazione: string) {
  return {
    tenant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ parentTenantId: null }),
    },
    consultantTenantAssociation: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.consultantUserId === CONSULENTE && where.tenantId === CLIENTE
            ? { id: 'a1', role: { name: ruoloAssociazione } }
            : null
        )
      ),
    },
  } as any
}

const corpoValido = {
  produttoreId: 'p1',
  rifiuto: { cerCode: '20 03 01', quantita: 100, unitaMisura: 'kg' },
  trasportatoreId: 't1',
  destinatarioId: 'd1',
  provenienza: 'SPECIALE',
  tipoTrattaPrincipale: 'TERRESTRE',
  versione: 1,
}

function firModificato(versione: number): FIR {
  const fir = FIR.create({
    produttoreId: 'p1',
    rifiuto: { cerCode: '20 03 01', quantita: 100, unitaMisura: UnitaMisura.KG },
    trasportatoreId: 't1',
    destinatarioId: 'd1',
    provenienza: ProvenienzaRifiuto.SPECIALE,
    tipoTrattaPrincipale: TipoTratta.TERRESTRE,
  } as any)
  fir.registraVersioneSalvata(versione)
  return fir
}

describe('PUT /fir/:id — catena HTTP con azienda selezionata', () => {
  let app: INestApplication
  let modifica: { execute: jest.Mock }
  let enforcement: { assertNotSuspended: jest.Mock; assertFirLimitNotReached: jest.Mock }

  // ADMIN del proprio studio (ruolo del token), che lavora nell'azienda del cliente.
  let conferma: { execute: jest.Mock }
  let collegamentiAccesso: { pesoPerConsegnaFir: jest.Mock }
  const utente = { id: CONSULENTE, email: 'c@studio.it', tenantId: STUDIO, role: 'ADMIN' }

  async function avvia(ruoloAssociazione = 'OPERATOR') {
    const prisma = prismaFinto(ruoloAssociazione)
    modifica = { execute: jest.fn().mockResolvedValue(Result.ok(firModificato(2))) }
    conferma = { execute: jest.fn().mockResolvedValue(Result.ok(firModificato(2))) }
    collegamentiAccesso = { pesoPerConsegnaFir: jest.fn().mockResolvedValue(12.35) }
    enforcement = {
      assertNotSuspended: jest.fn().mockResolvedValue(undefined),
      assertFirLimitNotReached: jest.fn().mockResolvedValue(undefined),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [FIRControllerV2],
      providers: [
        { provide: CreateFIRUseCase, useValue: { execute: jest.fn() } },
        { provide: EmettiFIRUseCase, useValue: { execute: jest.fn() } },
        { provide: PresaInCaricoFIRUseCase, useValue: { execute: jest.fn() } },
        { provide: ConfermaConsegnaFIRUseCase, useValue: conferma },
        { provide: CollegamentiAccessoService, useValue: collegamentiAccesso },
        { provide: AnnullaFIRUseCase, useValue: { execute: jest.fn() } },
        { provide: ModificaFIRUseCase, useValue: modifica },
        { provide: GetFIRByIdQueryHandler, useValue: { execute: jest.fn() } },
        { provide: ListFIRsQueryHandler, useValue: { execute: jest.fn() } },
        { provide: SubscriptionEnforcementService, useValue: enforcement },
        { provide: RuoloEffettivoService, useValue: new RuoloEffettivoService(prisma) },
        {
          provide: MembershipService,
          useValue: new MembershipService(prisma, prisma, { generateTokenPair: jest.fn() } as any),
        },
        { provide: APP_INTERCEPTOR, useClass: TenantSwitchInterceptor },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = utente
          return true
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()

    app = moduleRef.createNestApplication()
    // Stessa configurazione di main.ts
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  }

  const put = (corpo: unknown, id = FIR_ID) =>
    request(app.getHttpServer())
      .put(`/fir/${id}`)
      .set('X-Tenant-ID', CLIENTE)
      .send(corpo as object)

  afterEach(async () => {
    await app?.close()
  })

  describe('POST /fir/:id/conferma-consegna (peso dal netto di un accesso)', () => {
    const ACCESSO = '9d9d9d9d-0000-4000-8000-000000000009'
    const conf = (corpo: unknown) =>
      request(app.getHttpServer())
        .post(`/fir/${FIR_ID}/conferma-consegna`)
        .set('X-Tenant-ID', CLIENTE)
        .send(corpo as object)

    beforeEach(() => avvia())

    it('solo pesoEffettivo: comportamento invariato, nessuna lettura della pesa', async () => {
      await conf({ pesoEffettivo: 10.5 }).expect(200)
      expect(conferma.execute.mock.calls[0][0].pesoEffettivo).toBe(10.5)
      expect(collegamentiAccesso.pesoPerConsegnaFir).not.toHaveBeenCalled()
    })

    it('né peso né accesso → 400; entrambi → 400; use case non chiamato', async () => {
      const r = await conf({}).expect(400)
      expect(r.body.message).toBe("Indicare il peso verificato oppure l'accesso da cui prenderlo.")
      await conf({ pesoEffettivo: 1, accessoId: ACCESSO }).expect(400)
      await conf({ accessoId: 'abc' }).expect(400)
      expect(conferma.execute).not.toHaveBeenCalled()
    })

    it('accessoId: lo use case riceve il netto convertito, per l`azienda selezionata', async () => {
      await conf({ accessoId: ACCESSO }).expect(200)
      expect(collegamentiAccesso.pesoPerConsegnaFir).toHaveBeenCalledWith(
        CLIENTE,
        CONSULENTE,
        FIR_ID,
        ACCESSO
      )
      expect(conferma.execute.mock.calls[0][0].pesoEffettivo).toBe(12.35)
    })

    it('accesso collegato a un altro FIR → 409, use case non chiamato', async () => {
      collegamentiAccesso.pesoPerConsegnaFir.mockRejectedValue(
        new StatoAccessoNonValidoError("L'accesso o il documento è già collegato.")
      )
      await conf({ accessoId: ACCESSO }).expect(409)
      expect(conferma.execute).not.toHaveBeenCalled()
    })

    it('FIR legato a RENTRI, in m3 o netto troppo piccolo → 422 in italiano, use case non chiamato', async () => {
      collegamentiAccesso.pesoPerConsegnaFir.mockRejectedValue(
        new CollegamentoNonValidoError('Il FIR è in M3: il peso della pesa (kg) non si converte.')
      )
      const r = await conf({ accessoId: ACCESSO }).expect(422)
      expect(r.body.message).toContain('non si converte')
      expect(conferma.execute).not.toHaveBeenCalled()
    })

    it('ruolo effettivo di sola lettura (CONSULTANT) con accessoId → 403', async () => {
      await app.close()
      await avvia('CONSULTANT')
      const r = await conf({ accessoId: ACCESSO }).expect(403)
      expect(r.body.error).toBe('PESE_RISERVATE_OPERATORI')
      expect(collegamentiAccesso.pesoPerConsegnaFir).not.toHaveBeenCalled()
    })
  })

  describe('esito', () => {
    it("200 con la nuova versione, nell'azienda selezionata e con l'utente del token", async () => {
      await avvia()

      const risposta = await put(corpoValido)

      expect(risposta.status).toBe(200)
      expect(risposta.body.versione).toBe(2)
      expect(risposta.body.modificabile).toBe(true)
      expect(risposta.body.motivoNonModificabile).toBeNull()
      const comando = modifica.execute.mock.calls[0][0]
      expect(comando).toMatchObject({
        firId: FIR_ID,
        tenantId: CLIENTE,
        userId: CONSULENTE,
        versione: 1,
      })
      expect(comando.rifiuto.unitaMisura).toBe('kg')
      expect(enforcement.assertNotSuspended).toHaveBeenCalledWith(CLIENTE)
      expect(enforcement.assertFirLimitNotReached).not.toHaveBeenCalled()
    })

    it('409 FIR_MODIFICATO_NEL_FRATTEMPO con corpo { error, message } e senza id', async () => {
      await avvia()
      modifica.execute.mockRejectedValue(new FirModificatoNelFrattempoError(FIR_ID))

      const risposta = await put(corpoValido)

      expect(risposta.status).toBe(409)
      expect(risposta.body.error).toBe('FIR_MODIFICATO_NEL_FRATTEMPO')
      expect(risposta.body.message).toBe(FirModificatoNelFrattempoError.MESSAGGIO_UTENTE)
      expect(risposta.body.message).not.toContain(FIR_ID)
      expect(risposta.body.message).not.toContain(CLIENTE)
    })

    it.each(['LEGATO_RENTRI', 'NON_BOZZA', 'FIRMATO', 'IN_ATTESA_FIRMA_PRODUTTORE'] as const)(
      '409 FIR_NON_MODIFICABILE con il motivo %s',
      async motivo => {
        await avvia()
        modifica.execute.mockRejectedValue(new FirNonModificabileError(motivo))

        const risposta = await put(corpoValido)

        expect(risposta.status).toBe(409)
        expect(risposta.body.error).toBe('FIR_NON_MODIFICABILE')
        expect(risposta.body.message).toBe(FirNonModificabileError.MESSAGGI[motivo])
        expect(risposta.body.message).not.toContain(CLIENTE)
      }
    )

    it('404 FIR_NON_TROVATO senza id di FIR ne di tenant', async () => {
      await avvia()
      modifica.execute.mockRejectedValue(new FirNonTrovatoError())

      const risposta = await put(corpoValido)

      expect(risposta.status).toBe(404)
      expect(risposta.body.error).toBe('FIR_NON_TROVATO')
      expect(risposta.body.message).toBe('FIR non trovato')
      expect(risposta.body.message).not.toContain(FIR_ID)
      expect(risposta.body.message).not.toContain(CLIENTE)
    })

    it('Result.fail del caso d uso (es. CER non utilizzabile) → 400', async () => {
      await avvia()
      modifica.execute.mockResolvedValue(Result.fail('Il CER 99 99 99 non esiste'))

      const risposta = await put(corpoValido)

      expect(risposta.status).toBe(400)
    })
  })

  describe('ruolo e abbonamento', () => {
    it('CONSULTANT nell azienda selezionata (VIEWER) → 403, anche se il token dice ADMIN', async () => {
      await avvia('CONSULTANT')

      const risposta = await put(corpoValido)

      expect(risposta.status).toBe(403)
      expect(risposta.body.error).toBe('FIR_RISERVATO_OPERATORI')
      expect(modifica.execute).not.toHaveBeenCalled()
    })

    it('azienda sospesa → il caso d uso non parte', async () => {
      await avvia()
      // L'eccezione vera di SubscriptionEnforcementService per un'azienda sospesa.
      enforcement.assertNotSuspended.mockRejectedValue(
        new ForbiddenException(
          "L'account è sospeso (pagamento non ricevuto o non autorizzato). " +
            'Contatta il supporto o accedi alla pagina Abbonamento per ripristinare il servizio.'
        )
      )

      const risposta = await put(corpoValido)

      expect(risposta.status).toBe(403)
      expect(risposta.body.error).toBe('Forbidden')
      expect(risposta.body.message).toContain("L'account è sospeso")
      expect(modifica.execute).not.toHaveBeenCalled()
    })
  })

  describe('validazione con la ValidationPipe vera', () => {
    const senza = (campo: string) => {
      const { [campo]: _tolto, ...resto } = corpoValido as any
      return resto
    }
    const conRifiuto = (modifiche: object) => ({
      ...corpoValido,
      rifiuto: { ...corpoValido.rifiuto, ...modifiche },
    })

    it('id non uuid → 400 e nessuna chiamata', async () => {
      await avvia()
      const risposta = await put(corpoValido, 'non-un-uuid')
      expect(risposta.status).toBe(400)
      expect(modifica.execute).not.toHaveBeenCalled()
    })

    it.each([
      ['versione mancante', senza('versione')],
      ['versione 0', { ...corpoValido, versione: 0 }],
      ['versione stringa', { ...corpoValido, versione: '1' }],
      ['versione decimale', { ...corpoValido, versione: 1.5 }],
      ['cerCode mancante', conRifiuto({ cerCode: undefined })],
      ['cerCode vuoto', conRifiuto({ cerCode: '' })],
      ['unitaMisura mancante', conRifiuto({ unitaMisura: undefined })],
      ['unitaMisura non valida', conRifiuto({ unitaMisura: 'tonnellate' })],
      ['quantita zero', conRifiuto({ quantita: 0 })],
      ['provenienza mancante', senza('provenienza')],
      ['rifiuto.descrizione', conRifiuto({ descrizione: 'x' })],
      ['rifiuto.categoria', conRifiuto({ categoria: 'x' })],
      ['rifiuto.tipoOperazione', conRifiuto({ tipoOperazione: 'RECOVERY' })],
      ['stato', { ...corpoValido, stato: 'EMESSO' }],
      ['numeroProgressivo', { ...corpoValido, numeroProgressivo: 'FIR-1' }],
      ['tenantId', { ...corpoValido, tenantId: CLIENTE }],
    ])('400 e nessuna chiamata: %s', async (_nome, corpo) => {
      await avvia()
      const risposta = await put(corpo)
      expect(risposta.status).toBe(400)
      expect(modifica.execute).not.toHaveBeenCalled()
    })
  })
})
