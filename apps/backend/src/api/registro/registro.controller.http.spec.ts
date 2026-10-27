/**
 * Registro attraverso la catena HTTP reale: JwtAuthGuard (finto) → TenantSwitchInterceptor
 * globale → RegistroController → filtro globale delle eccezioni.
 *
 * Verifica che l'azienda selezionata con `X-Tenant-ID` sia quella su cui si scrive, che il
 * ruolo conti in quella azienda e che una selezione non più valida venga rifiutata invece di
 * ricadere in silenzio sull'azienda primaria del token (dove il movimento finirebbe nel
 * registro sbagliato, che non si può correggere).
 */

import { Test } from '@nestjs/testing'
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { RegistroController } from './registro.controller'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { ListMovimentiHandler } from '../../application/registro/queries/list-movimenti.handler'
import { ProgressivoInizialeService } from '../../application/registro/progressivo-iniziale.service'
import { RegistriService } from '../../application/registro/registri.service'
import { GiacenzeInizialiService } from '../../application/registro/giacenze-iniziali.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MembershipService } from '../me/membership.service'
import { TenantSwitchInterceptor } from '../../core/interceptors/tenant-switch.interceptor'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { Result } from '../../core/application/result'

const STUDIO = '5a5a5a5a-0000-4000-8000-000000000001'
const CLIENTE = 'c1c1c1c1-0000-4000-8000-000000000002'
const CONSULENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const REGISTRO = '7e7e7e7e-0000-4000-8000-000000000004'
const GIACENZA = '9a9a9a9a-0000-4000-8000-000000000005'
const IERI = new Date(Date.now() - 24 * 60 * 60 * 1000)

interface Associazione {
  tenantId: string
  isActive: boolean
  expiresAt: Date | null
  role: { name: string }
}

/**
 * Prisma finto che applica i filtri `where` di `checkAccess` e di `ruoloEffettivo`
 * (associazione attiva e non scaduta), con una sola associazione del consulente al cliente.
 */
function prismaFinto(associazione: Associazione) {
  const valida = (where: any): boolean => {
    if (where.consultantUserId !== CONSULENTE || where.tenantId !== associazione.tenantId) {
      return false
    }
    if (where.isActive === true && !associazione.isActive) return false
    return (where.OR ?? [{ expiresAt: null }]).some((c: any) =>
      c.expiresAt === null
        ? associazione.expiresAt === null
        : associazione.expiresAt !== null && associazione.expiresAt > c.expiresAt.gt
    )
  }
  return {
    tenant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ parentTenantId: null }),
    },
    consultantTenantAssociation: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(valida(where) ? { id: 'a1', role: associazione.role } : null)
      ),
    },
  } as any
}

const movimento = {
  type: 'CARICO',
  movementDate: '2026-03-11',
  causale: 'PRODUZIONE_INTERNA',
  cerCode: '20 03 01',
  quantity: 100,
}

describe('RegistroController — catena HTTP con azienda selezionata', () => {
  let app: INestApplication
  let registra: { execute: jest.Mock }
  let giacenze: { elenca: jest.Mock; crea: jest.Mock; modifica: jest.Mock; elimina: jest.Mock }

  // ADMIN del proprio studio (ruolo del token), che lavora nell'azienda del cliente.
  const utente = { id: CONSULENTE, email: 'c@studio.it', tenantId: STUDIO, role: 'ADMIN' }

  async function avvia(associazione: Associazione) {
    const prisma = prismaFinto(associazione)
    registra = { execute: jest.fn().mockResolvedValue(Result.ok({ id: 'm1' })) }
    giacenze = {
      elenca: jest.fn().mockResolvedValue({ registroId: REGISTRO, voci: [] }),
      crea: jest.fn().mockResolvedValue({ giacenza: { id: GIACENZA }, avvisi: [] }),
      modifica: jest.fn().mockResolvedValue({ giacenza: { id: GIACENZA } }),
      elimina: jest.fn().mockResolvedValue(undefined),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [RegistroController],
      providers: [
        { provide: RegistraMovimentoUseCase, useValue: registra },
        { provide: ListMovimentiHandler, useValue: { execute: jest.fn() } },
        { provide: ProgressivoInizialeService, useValue: {} },
        { provide: RegistriService, useValue: {} },
        { provide: GiacenzeInizialiService, useValue: giacenze },
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
      .compile()

    app = moduleRef.createNestApplication()
    // Stessa configurazione di main.ts
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  }

  afterEach(async () => {
    await app?.close()
  })

  it('associazione scaduta: 403 AZIENDA_SELEZIONATA_NON_ACCESSIBILE e nessuna scrittura nello studio', async () => {
    await avvia({ tenantId: CLIENTE, isActive: true, expiresAt: IERI, role: { name: 'OPERATOR' } })

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send(movimento)

    expect(risposta.status).toBe(403)
    expect(risposta.body.error).toBe('AZIENDA_SELEZIONATA_NON_ACCESSIBILE')
    expect(registra.execute).not.toHaveBeenCalled()
  })

  it('associazione CONSULTANT (sola consultazione): 403 REGISTRO_RISERVATO_OPERATORI', async () => {
    await avvia({
      tenantId: CLIENTE,
      isActive: true,
      expiresAt: null,
      role: { name: 'CONSULTANT' },
    })

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send(movimento)

    expect(risposta.status).toBe(403)
    expect(risposta.body.error).toBe('REGISTRO_RISERVATO_OPERATORI')
    expect(registra.execute).not.toHaveBeenCalled()
  })

  it('registro controller: registroId non uuid → 400, senza arrivare allo use case', async () => {
    await avvia({ tenantId: CLIENTE, isActive: true, expiresAt: null, role: { name: 'OPERATOR' } })

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send({ ...movimento, registroId: 'non-un-uuid' })

    expect(risposta.status).toBe(400)
    expect(registra.execute).not.toHaveBeenCalled()
  })

  it("associazione OPERATOR: 201 e il movimento va nell'azienda selezionata", async () => {
    await avvia({ tenantId: CLIENTE, isActive: true, expiresAt: null, role: { name: 'OPERATOR' } })

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send(movimento)

    expect(risposta.status).toBe(201)
    expect(registra.execute).toHaveBeenCalledTimes(1)
    expect(registra.execute.mock.calls[0][0].tenantId).toBe(CLIENTE)
    expect(registra.execute.mock.calls[0][0].userId).toBe(CONSULENTE)
  })

  describe('giacenze iniziali', () => {
    const aperto = (ruolo: string) =>
      avvia({ tenantId: CLIENTE, isActive: true, expiresAt: null, role: { name: ruolo } })
    const corpo = {
      cerCode: '15 01 10*',
      quantita: 100,
      unita: 'KG',
      dataRiferimento: '2026-01-01',
    }
    const sostituzione = { quantita: 80, unita: 'KG', dataRiferimento: '2026-01-02' }
    const http = () => request(app.getHttpServer())

    it("GET: un OPERATOR legge, con puoImpostare=false, sull'azienda selezionata", async () => {
      await aperto('OPERATOR')
      const risposta = await http()
        .get('/registro/giacenze-iniziali?registroId=' + REGISTRO)
        .set('X-Tenant-ID', CLIENTE)
      expect(risposta.status).toBe(200)
      expect(risposta.body).toEqual({ registroId: REGISTRO, puoImpostare: false, voci: [] })
      expect(giacenze.elenca).toHaveBeenCalledWith(CLIENTE, REGISTRO)
    })

    it('GET: registroId non uuid → 400 senza arrivare al servizio', async () => {
      await aperto('ADMIN')
      const risposta = await http()
        .get('/registro/giacenze-iniziali?registroId=boh')
        .set('X-Tenant-ID', CLIENTE)
      expect(risposta.status).toBe(400)
      expect(giacenze.elenca).not.toHaveBeenCalled()
    })

    it('un registroId inesistente è un 404 (propagato dal servizio) su GET e POST', async () => {
      await aperto('ADMIN')
      giacenze.elenca.mockRejectedValue(new NotFoundException('Registro non trovato.'))
      giacenze.crea.mockRejectedValue(new NotFoundException('Registro non trovato.'))
      const get = await http()
        .get('/registro/giacenze-iniziali?registroId=' + REGISTRO)
        .set('X-Tenant-ID', CLIENTE)
      const post = await http()
        .post('/registro/giacenze-iniziali?registroId=' + REGISTRO)
        .set('X-Tenant-ID', CLIENTE)
        .send(corpo)
      expect([get.status, post.status]).toEqual([404, 404])
    })

    it("POST da ADMIN effettivo: 201 con giacenza e avvisi, nell'azienda selezionata", async () => {
      await aperto('ADMIN')
      const origini = [{ anno: 2025, protocollo: 3, quantita: 50.5 }]
      const risposta = await http()
        .post('/registro/giacenze-iniziali')
        .set('X-Tenant-ID', CLIENTE)
        .send({ ...corpo, origini })
      expect(risposta.status).toBe(201)
      expect(risposta.body).toEqual({ giacenza: { id: GIACENZA }, avvisi: [] })
      expect(giacenze.crea).toHaveBeenCalledTimes(1)
      const [tenant, utente, dati, registro] = giacenze.crea.mock.calls[0]
      expect([tenant, utente, registro]).toEqual([CLIENTE, CONSULENTE, undefined])
      expect(dati).toMatchObject({ ...corpo, origini })
    })

    it("scritture negate (403) a OPERATOR e CONSULTANT nell'azienda selezionata, ADMIN a casa", async () => {
      for (const ruolo of ['OPERATOR', 'CONSULTANT']) {
        await aperto(ruolo)
        // lazy: una richiesta supertest apre il server alla creazione, non la si prepara in anticipo
        const rotte = [
          () => http().post('/registro/giacenze-iniziali').send(corpo),
          () =>
            http()
              .put('/registro/giacenze-iniziali/' + GIACENZA)
              .send(sostituzione),
          () => http().delete('/registro/giacenze-iniziali/' + GIACENZA),
        ]
        for (const r of rotte) {
          const risposta = await r().set('X-Tenant-ID', CLIENTE)
          expect({ ruolo, stato: risposta.status, errore: risposta.body.error }).toEqual({
            ruolo,
            stato: 403,
            errore: 'REGISTRO_GIACENZA_INIZIALE_RISERVATA_AMMINISTRATORI',
          })
        }
        expect(giacenze.crea).not.toHaveBeenCalled()
        expect(giacenze.modifica).not.toHaveBeenCalled()
        expect(giacenze.elimina).not.toHaveBeenCalled()
        // un'app per ruolo: si chiude quella usata qui, l'ultima la chiude afterEach
        if (ruolo !== 'CONSULTANT') await app.close()
      }
    })

    it('POST: corpi non validi → 400 e il servizio non è chiamato', async () => {
      await aperto('ADMIN')
      const nonValidi: Array<Record<string, unknown>> = [
        { ...corpo, dataRiferimento: '2026-01-01T10:00:00.000Z' },
        { ...corpo, dataRiferimento: '2026-02-30' },
        { ...corpo, dataRiferimento: '01/01/2026' },
        { ...corpo, quantita: 0 },
        { ...corpo, quantita: 1.234 },
        { ...corpo, quantita: '10' },
        { ...corpo, origini: [{ anno: 2025 }] },
        { ...corpo, origini: [{ anno: 2025, protocollo: 1, quantita: -1 }] },
        { ...corpo, origini: 'x' },
        { ...corpo, tenantId: 'altra-azienda' },
      ]
      for (const c of nonValidi) {
        const risposta = await http()
          .post('/registro/giacenze-iniziali')
          .set('X-Tenant-ID', CLIENTE)
          .send(c)
        expect({ c, stato: risposta.status }).toEqual({ c, stato: 400 })
      }
      expect(giacenze.crea).not.toHaveBeenCalled()
    })

    it('PUT è una sostituzione completa: statoFisico, origini e note omessi arrivano assenti al servizio, che li svuota', async () => {
      await aperto('ADMIN')
      const risposta = await http()
        .put('/registro/giacenze-iniziali/' + GIACENZA)
        .set('X-Tenant-ID', CLIENTE)
        .send(sostituzione)
      expect(risposta.status).toBe(200)
      expect(risposta.body).toEqual({ giacenza: { id: GIACENZA } })
      const [tenant, utente, id, dati] = giacenze.modifica.mock.calls[0]
      expect([tenant, utente, id]).toEqual([CLIENTE, CONSULENTE, GIACENZA])
      expect(dati.statoFisico).toBeUndefined()
      expect(dati.origini).toBeUndefined()
      expect(dati.note).toBeUndefined()
      expect(dati).toMatchObject(sostituzione)
    })

    it('PUT: campi obbligatori mancanti, cerCode nel corpo o id non uuid → 400', async () => {
      await aperto('ADMIN')
      const prove = [
        () =>
          http()
            .put('/registro/giacenze-iniziali/' + GIACENZA)
            .send({ unita: 'KG' }),
        () =>
          http()
            .put('/registro/giacenze-iniziali/' + GIACENZA)
            .send({ ...sostituzione, cerCode: '15 01 10*' }),
        () => http().put('/registro/giacenze-iniziali/non-uuid').send(sostituzione),
      ]
      for (const p of prove) {
        expect((await p().set('X-Tenant-ID', CLIENTE)).status).toBe(400)
      }
      expect(giacenze.modifica).not.toHaveBeenCalled()
    })

    it('DELETE: 204 senza corpo; id non uuid → 400; 404 e 409 del servizio propagati', async () => {
      await aperto('ADMIN')
      const ok = await http()
        .delete('/registro/giacenze-iniziali/' + GIACENZA)
        .set('X-Tenant-ID', CLIENTE)
      expect(ok.status).toBe(204)
      expect(ok.text).toBe('')
      expect(giacenze.elimina).toHaveBeenCalledWith(CLIENTE, CONSULENTE, GIACENZA)

      const nonUuid = await http()
        .delete('/registro/giacenze-iniziali/1')
        .set('X-Tenant-ID', CLIENTE)
      expect(nonUuid.status).toBe(400)

      giacenze.elimina.mockRejectedValueOnce(new NotFoundException('Giacenza non trovata.'))
      giacenze.elimina.mockRejectedValueOnce(new ConflictException('usata'))
      const stati: number[] = []
      for (let i = 0; i < 2; i++) {
        const r = await http()
          .delete('/registro/giacenze-iniziali/' + GIACENZA)
          .set('X-Tenant-ID', CLIENTE)
        stati.push(r.status)
      }
      expect(stati).toEqual([404, 409])
    })
  })
})
