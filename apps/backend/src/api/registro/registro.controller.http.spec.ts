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
import { CorreggiMovimentoUseCase } from '../../application/registro/use-cases/correggi-movimento.use-case'
import { VerificaCatenaRegistroService } from '../../application/registro/verifica-catena-registro.service'
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
const MOVIMENTO = '3b3b3b3b-0000-4000-8000-000000000006'
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
  let correggi: { rettifica: jest.Mock; annulla: jest.Mock }
  let verifica: { verifica: jest.Mock }
  let registri: { risolviInLettura: jest.Mock }

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
    correggi = {
      rettifica: jest.fn().mockResolvedValue({ movimento: { id: 'nuova' }, avvisi: [] }),
      annulla: jest.fn().mockResolvedValue({ movimento: { id: 'annullo' }, avvisi: ['a'] }),
    }
    verifica = {
      verifica: jest
        .fn()
        .mockResolvedValue({ verificate: 3, nonVerificabili: [], primoErrore: null }),
    }
    registri = { risolviInLettura: jest.fn().mockResolvedValue({ id: REGISTRO }) }
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
        { provide: RegistriService, useValue: registri },
        { provide: CorreggiMovimentoUseCase, useValue: correggi },
        { provide: VerificaCatenaRegistroService, useValue: verifica },
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

  it('causale di forma non valida (pippo): 400 dal DTO, senza arrivare al caso d\x27uso', async () => {
    await avvia({ tenantId: CLIENTE, isActive: true, expiresAt: null, role: { name: 'OPERATOR' } })

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send({ ...movimento, causale: 'pippo' })

    expect(risposta.status).toBe(400)
    expect(registra.execute).not.toHaveBeenCalled()
  })

  it('causale ben formata ma fuori catalogo (NON_ESISTE): passa il DTO e il 400 lo dà il caso d\x27uso', async () => {
    await avvia({ tenantId: CLIENTE, isActive: true, expiresAt: null, role: { name: 'OPERATOR' } })
    registra.execute.mockResolvedValue(
      Result.fail('Causale non valida per CARICO: NON_ESISTE. Valori: PRODUZIONE_INTERNA')
    )

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send({ ...movimento, causale: 'NON_ESISTE' })

    expect(registra.execute).toHaveBeenCalledTimes(1)
    expect(registra.execute.mock.calls[0][0].causale).toBe('NON_ESISTE')
    expect(risposta.status).toBe(400)
    expect(JSON.stringify(risposta.body)).toContain('Causale non valida per CARICO')
  })

  it('causale modificata nel frattempo: il 409 CAUSALE_MODIFICATA del caso d uso arriva al client con il suo corpo', async () => {
    await avvia({ tenantId: CLIENTE, isActive: true, expiresAt: null, role: { name: 'OPERATOR' } })
    registra.execute.mockRejectedValueOnce(
      new ConflictException({
        message: 'La causale è stata modificata nel frattempo: ricarica e riprova.',
        error: 'CAUSALE_MODIFICATA',
      })
    )

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send(movimento)

    expect(risposta.status).toBe(409)
    expect(risposta.body.error).toBe('CAUSALE_MODIFICATA')
    expect(risposta.body.message).toContain('modificata nel frattempo')
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

  describe('correzioni e verifica catena', () => {
    const aperto = (ruolo: string) =>
      avvia({ tenantId: CLIENTE, isActive: true, expiresAt: null, role: { name: ruolo } })
    const http = () => request(app.getHttpServer())
    const rettificaCorpo = {
      movementDate: '2026-03-11',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '20 03 01',
      quantity: 90,
      motivo: '  Quantità errata ',
    }

    it("rettifica da OPERATOR effettivo: 201 { movimento, avvisi }, tenant e utente dell'azienda selezionata", async () => {
      await aperto('OPERATOR')
      const risposta = await http()
        .post(`/registro/movimenti/${MOVIMENTO}/rettifica`)
        .set('X-Tenant-ID', CLIENTE)
        .send({ ...rettificaCorpo, confermaAnnoPresentato: true })
      expect(risposta.status).toBe(201)
      expect(risposta.body).toEqual({ movimento: { id: 'nuova' }, avvisi: [] })
      const input = correggi.rettifica.mock.calls[0][0]
      expect(input).toMatchObject({
        tenantId: CLIENTE,
        userId: CONSULENTE,
        movimentoId: MOVIMENTO,
        motivo: 'Quantità errata',
        confermaAnnoPresentato: true,
      })
      expect(input.dati).toMatchObject({ causale: 'PRODUZIONE_INTERNA', quantity: 90, unit: 'KG' })
      expect(input.dati.movementDate).toEqual(new Date('2026-03-11'))
      expect(input.dati).not.toHaveProperty('motivo')
      expect(input.dati).not.toHaveProperty('confermaAnnoPresentato')
    })

    it('annullamento da ADMIN: 201 con gli avvisi del caso d uso', async () => {
      await aperto('ADMIN')
      const risposta = await http()
        .post(`/registro/movimenti/${MOVIMENTO}/annullamento`)
        .set('X-Tenant-ID', CLIENTE)
        .send({ motivo: 'Errore di registrazione' })
      expect(risposta.status).toBe(201)
      expect(risposta.body).toEqual({ movimento: { id: 'annullo' }, avvisi: ['a'] })
      expect(correggi.annulla).toHaveBeenCalledWith({
        tenantId: CLIENTE,
        userId: CONSULENTE,
        movimentoId: MOVIMENTO,
        motivo: 'Errore di registrazione',
        confermaAnnoPresentato: undefined,
      })
    })

    it('ruolo effettivo di sola consultazione: 403 su rettifica e annullamento, il caso d uso non parte', async () => {
      await aperto('CONSULTANT')
      for (const [rotta, corpo] of [
        ['rettifica', rettificaCorpo],
        ['annullamento', { motivo: 'x' }],
      ] as const) {
        const risposta = await http()
          .post(`/registro/movimenti/${MOVIMENTO}/${rotta}`)
          .set('X-Tenant-ID', CLIENTE)
          .send(corpo)
        expect({ rotta, stato: risposta.status, errore: risposta.body.error }).toEqual({
          rotta,
          stato: 403,
          errore: 'REGISTRO_RISERVATO_OPERATORI',
        })
      }
      expect(correggi.rettifica).not.toHaveBeenCalled()
      expect(correggi.annulla).not.toHaveBeenCalled()
    })

    it.each(['type', 'registroId', 'firId', 'registrationDate'])(
      'rettifica con %s nel corpo: 400 e nessuna chiamata',
      async campo => {
        await aperto('ADMIN')
        const valore =
          campo === 'type' ? 'CARICO' : campo === 'registrationDate' ? '2026-03-11' : REGISTRO
        const risposta = await http()
          .post(`/registro/movimenti/${MOVIMENTO}/rettifica`)
          .set('X-Tenant-ID', CLIENTE)
          .send({ ...rettificaCorpo, [campo]: valore })
        expect(risposta.status).toBe(400)
        expect(correggi.rettifica).not.toHaveBeenCalled()
      }
    )

    it('id non uuid, motivo mancante o vuoto: 400 e nessuna chiamata', async () => {
      await aperto('ADMIN')
      // lazy: una richiesta supertest apre il server alla creazione, non la si prepara in anticipo
      const prove = [
        () => http().post('/registro/movimenti/1/annullamento').send({ motivo: 'x' }),
        () => http().post('/registro/movimenti/1/rettifica').send(rettificaCorpo),
        () => http().post(`/registro/movimenti/${MOVIMENTO}/annullamento`).send({}),
        () => http().post(`/registro/movimenti/${MOVIMENTO}/annullamento`).send({ motivo: '   ' }),
        () =>
          http()
            .post(`/registro/movimenti/${MOVIMENTO}/rettifica`)
            .send({ ...rettificaCorpo, motivo: undefined }),
      ]
      for (const p of prove) expect((await p().set('X-Tenant-ID', CLIENTE)).status).toBe(400)
      expect(correggi.rettifica).not.toHaveBeenCalled()
      expect(correggi.annulla).not.toHaveBeenCalled()
    })

    it('404 e 409 del caso d uso arrivano invariati; il 409 MUD porta error REGISTRO_ANNO_MUD_PRESENTATO', async () => {
      await aperto('ADMIN')
      correggi.rettifica.mockRejectedValueOnce(new NotFoundException('Movimento non trovato'))
      correggi.annulla.mockRejectedValueOnce(
        new ConflictException({
          message: 'Il MUD 2026 risulta già presentato',
          error: 'REGISTRO_ANNO_MUD_PRESENTATO',
        })
      )
      correggi.annulla.mockRejectedValueOnce(new ConflictException('Movimento già corretto'))
      const nonTrovato = await http()
        .post(`/registro/movimenti/${MOVIMENTO}/rettifica`)
        .set('X-Tenant-ID', CLIENTE)
        .send(rettificaCorpo)
      const mud = await http()
        .post(`/registro/movimenti/${MOVIMENTO}/annullamento`)
        .set('X-Tenant-ID', CLIENTE)
        .send({ motivo: 'x' })
      const giaCorretto = await http()
        .post(`/registro/movimenti/${MOVIMENTO}/annullamento`)
        .set('X-Tenant-ID', CLIENTE)
        .send({ motivo: 'x' })
      expect(nonTrovato.status).toBe(404)
      expect(mud.status).toBe(409)
      expect(mud.body.error).toBe('REGISTRO_ANNO_MUD_PRESENTATO')
      expect(mud.body.message).toBe('Il MUD 2026 risulta già presentato')
      expect(giaCorretto.status).toBe(409)
      expect(giaCorretto.body.error).not.toBe('REGISTRO_ANNO_MUD_PRESENTATO')
    })

    it("verifica-catena da ADMIN: 200 con registroId, anno ed esito; registro risolto nell'azienda selezionata", async () => {
      await aperto('ADMIN')
      const risposta = await http()
        .get(`/registro/verifica-catena?anno=2026&registroId=${REGISTRO}`)
        .set('X-Tenant-ID', CLIENTE)
      expect(risposta.status).toBe(200)
      expect(risposta.body).toEqual({
        registroId: REGISTRO,
        anno: 2026,
        verificate: 3,
        nonVerificabili: [],
        primoErrore: null,
      })
      expect(registri.risolviInLettura).toHaveBeenCalledWith(CLIENTE, REGISTRO)
      expect(verifica.verifica).toHaveBeenCalledWith(CLIENTE, REGISTRO, 2026)
    })

    it('verifica-catena senza registroId usa il registro predefinito', async () => {
      await aperto('ADMIN')
      const risposta = await http()
        .get('/registro/verifica-catena?anno=2026')
        .set('X-Tenant-ID', CLIENTE)
      expect(risposta.status).toBe(200)
      expect(registri.risolviInLettura).toHaveBeenCalledWith(CLIENTE, undefined)
    })

    it('verifica-catena: OPERATOR, VIEWER e CONSULTANT ricevono 403 e nessuna lettura', async () => {
      for (const ruolo of ['OPERATOR', 'VIEWER', 'CONSULTANT']) {
        await aperto(ruolo)
        const risposta = await http()
          .get('/registro/verifica-catena?anno=2026')
          .set('X-Tenant-ID', CLIENTE)
        expect({ ruolo, stato: risposta.status }).toEqual({ ruolo, stato: 403 })
        expect(registri.risolviInLettura).not.toHaveBeenCalled()
        expect(verifica.verifica).not.toHaveBeenCalled()
        if (ruolo !== 'CONSULTANT') await app.close()
      }
    })

    it('verifica-catena: anno mancante, non intero, < 2000 o oltre anno corrente + 1: 400; registroId non uuid: 400', async () => {
      await aperto('ADMIN')
      const oltre = new Date().getFullYear() + 2
      const cattive = ['', '?anno=x', '?anno=1999', '?anno=2026.5', `?anno=${oltre}`]
      cattive.push('?anno=2026&registroId=x')
      for (const q of cattive) {
        const risposta = await http()
          .get(`/registro/verifica-catena${q}`)
          .set('X-Tenant-ID', CLIENTE)
        expect({ q, stato: risposta.status }).toEqual({ q, stato: 400 })
      }
      expect(verifica.verifica).not.toHaveBeenCalled()
      const limite = new Date().getFullYear() + 1
      const ok = await http()
        .get(`/registro/verifica-catena?anno=${limite}`)
        .set('X-Tenant-ID', CLIENTE)
      expect(ok.status).toBe(200)
    })

    it('verifica-catena: registroId di un altra azienda e 404; registro da indicare e 400 col messaggio del dominio', async () => {
      await aperto('ADMIN')
      const { RegistroNonTrovatoError, RegistroDaIndicareError } = jest.requireActual(
        '../../application/registro/registri.service'
      )
      registri.risolviInLettura.mockRejectedValueOnce(new RegistroNonTrovatoError())
      const altro = await http()
        .get(`/registro/verifica-catena?anno=2026&registroId=${REGISTRO}`)
        .set('X-Tenant-ID', CLIENTE)
      expect(altro.status).toBe(404)

      registri.risolviInLettura.mockRejectedValueOnce(new RegistroDaIndicareError())
      const daIndicare = await http()
        .get('/registro/verifica-catena?anno=2026')
        .set('X-Tenant-ID', CLIENTE)
      expect(daIndicare.status).toBe(400)
      expect(daIndicare.body.message).toBe(new RegistroDaIndicareError().message)
      expect(verifica.verifica).not.toHaveBeenCalled()
    })
  })
})
