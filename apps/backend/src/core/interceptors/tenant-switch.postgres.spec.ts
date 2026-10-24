/**
 * Cambio azienda provato su Postgres con un'app Nest reale (RLS pezzo 2c).
 *
 * Percorso reale, dalla richiesta HTTP all'handler:
 *   TenantContextMiddleware (JWT firmato) -> JwtAuthGuard + JwtStrategy -> TenantSwitchInterceptor
 *   (MembershipService.checkAccess) -> handler.
 *
 * Reali: PrismaModule (PrismaService della factory applicativa e client di sistema), middleware,
 * strategia JWT, guard, interceptor, MembershipService, JwtTokensService, Postgres.
 * Finto, e solo questo: RedisService (lista di revoca ed epoca di sessione: nessun Redis in test,
 * qui rispondono "nessuna revoca, nessuna epoca"). Non e' un pezzo sotto prova.
 *
 * Come si osserva l'azienda: l'handler legge `current_setting('app.tenant_id', true)` con un
 * `$queryRaw` sul PrismaService iniettato (che lo imposta per operazione dallo store del
 * TenantContext) e, in piu', lo store stesso (`getStoreTenantId`). Un handler fuori dal contesto
 * dello switch vedrebbe l'azienda del token.
 *
 * Prova di significativita': con `TEST_SENZA_INTERCEPTOR=1` l'interceptor non e' registrato e il
 * caso del consulente deve FALLIRE: l'handler vede l'azienda del token e non quella dell'header.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'

const urlBase =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlBase

import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { TenantContext } from '../context/tenant-context'
import { TenantContextMiddleware } from '../middleware/tenant-context.middleware'
import { TenantSwitchInterceptor } from './tenant-switch.interceptor'
import { MembershipService } from '../../api/me/membership.service'
import { JwtTokensService } from '../../auth/services/jwt-tokens.service'
import { JwtStrategy } from '../../auth/strategies/jwt.strategy'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RedisService } from '../../auth/services/redis.service'

const SEGRETO = 'segreto-di-prova-tenant-switch-postgres'
const SENZA_INTERCEPTOR = process.env.TEST_SENZA_INTERCEPTOR === '1'

/** Cio' che l'handler ha visto, per richiesta. */
interface Osservazione {
  store: string | null
  db: string | null
}
let osservazioni: Osservazione[] = []

@Controller('prova-cambio-azienda')
class ProvaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async leggi() {
    const righe = await this.prisma.$queryRaw<
      Array<{ t: string | null }>
    >`SELECT current_setting('app.tenant_id', true) AS t`
    const osservazione: Osservazione = {
      store: TenantContext.getStoreTenantId(),
      db: righe[0]?.t || null,
    }
    osservazioni.push(osservazione)
    return osservazione
  }
}

// Redis finto: nessuna revoca, nessuna epoca di sessione.
const redisFinto = {
  isAccessTokenRevoked: async () => false,
  leggiEpocaSessione: async () => null,
}

@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      isGlobal: true,
      load: [() => ({ JWT_SECRET: SEGRETO })],
    }),
    PassportModule,
    JwtModule.register({ secret: SEGRETO }),
    PrismaModule,
  ],
  controllers: [ProvaController],
  providers: [
    TenantContextMiddleware,
    MembershipService,
    JwtTokensService,
    JwtStrategy,
    { provide: RedisService, useValue: redisFinto },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    ...(SENZA_INTERCEPTOR ? [] : [{ provide: APP_INTERCEPTOR, useClass: TenantSwitchInterceptor }]),
  ],
})
class AppProvaModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*')
  }
}

describe('Cambio azienda: dal middleware all handler su Postgres', () => {
  const admin = new PrismaClient({ datasources: { db: { url: urlBase } } })
  const run = randomUUID().replace(/-/g, '')
  let app: INestApplication
  let tokens: JwtTokensService

  const tenantIds: string[] = []
  const userIds: string[] = []
  let aziendaUtente = '' // azienda primaria dell'utente normale
  let aziendaStudio = '' // azienda primaria del consulente
  let aziendaCliente = '' // cliente del consulente (associazione attiva)
  let aziendaEstranea = '' // nessuna associazione
  let utenteNormale = ''
  let consulente = ''
  let superAdmin = ''
  let ruoloId = ''
  let contatorePiva = 0

  /** 11 cifre uniche per esecuzione (campo @unique). */
  const nuovaPiva = () => {
    contatorePiva += 1
    return String(Number(`${Date.now()}`.slice(-9)) * 100 + contatorePiva)
      .slice(-11)
      .padStart(11, '7')
  }

  async function creaAzienda(nome: string): Promise<string> {
    const t = await admin.tenant.create({
      data: { partitaIva: nuovaPiva(), ragioneSociale: `${nome} ${run}` },
    })
    tenantIds.push(t.id)
    return t.id
  }

  // Contatore deterministico: il codice fiscale e' unico per (tenantId, fiscalCode).
  let contatoreUtenti = 0

  async function creaUtente(tenantId: string, ruolo: 'ADMIN' | 'SUPER_ADMIN', nome: string) {
    const u = await admin.user.create({
      data: {
        tenantId,
        email: `${nome}-${run}@example.it`,
        fiscalCode: `TSTTNT00A00A${String(100 + contatoreUtenti++)}Z`,
        firstName: 'Prova',
        lastName: nome,
        role: ruolo,
        keycloakId: `kc-${nome}-${run}`,
      },
    })
    userIds.push(u.id)
    return u
  }

  const token = (utenteId: string, tenantId: string, role: string) =>
    tokens.generateAccessToken({ id: utenteId, email: 'x@example.it', tenantId, role })

  beforeAll(async () => {
    aziendaUtente = await creaAzienda('Azienda Utente')
    aziendaStudio = await creaAzienda('Studio Consulente')
    aziendaCliente = await creaAzienda('Cliente Consulente')
    aziendaEstranea = await creaAzienda('Azienda Estranea')

    utenteNormale = (await creaUtente(aziendaUtente, 'ADMIN', 'normale')).id
    consulente = (await creaUtente(aziendaStudio, 'ADMIN', 'consulente')).id
    superAdmin = (await creaUtente(aziendaStudio, 'SUPER_ADMIN', 'super')).id

    const ruolo = await admin.role.create({
      data: { tenantId: aziendaCliente, name: `CONSULTANT-${run}`, createdBy: consulente },
    })
    ruoloId = ruolo.id
    await admin.consultantTenantAssociation.create({
      data: {
        consultantUserId: consulente,
        tenantId: aziendaCliente,
        roleId: ruoloId,
        addedBy: consulente,
      },
    })

    const modulo = await Test.createTestingModule({ imports: [AppProvaModule] }).compile()
    app = modulo.createNestApplication()
    await app.init()
    tokens = app.get(JwtTokensService)
  })

  afterAll(async () => {
    if (app) await app.close()
    // Solo righe create da questo test: associazione, ruolo, utenti, aziende (cascade sui figli).
    await admin.consultantTenantAssociation.deleteMany({
      where: { consultantUserId: { in: userIds } },
    })
    if (ruoloId) await admin.role.deleteMany({ where: { id: ruoloId } })
    await admin.user.deleteMany({ where: { id: { in: userIds } } })
    await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await admin.$disconnect()
  })

  beforeEach(() => {
    osservazioni = []
  })

  it("utente normale senza X-Tenant-ID: l'handler vede l'azienda del token", async () => {
    const res = await request(app.getHttpServer())
      .get('/prova-cambio-azienda')
      .set('Authorization', `Bearer ${token(utenteNormale, aziendaUtente, 'ADMIN')}`)
      .expect(200)

    expect(res.body).toEqual({ store: aziendaUtente, db: aziendaUtente })
  })

  it("consulente con X-Tenant-ID di un'azienda associata: l'handler vede quell'azienda", async () => {
    const res = await request(app.getHttpServer())
      .get('/prova-cambio-azienda')
      .set('Authorization', `Bearer ${token(consulente, aziendaStudio, 'ADMIN')}`)
      .set('X-Tenant-ID', aziendaCliente)
      .expect(200)

    expect(res.body).toEqual({ store: aziendaCliente, db: aziendaCliente })
  })

  it("X-Tenant-ID di un'azienda senza associazione: 403 e l'handler non viene chiamato", async () => {
    await request(app.getHttpServer())
      .get('/prova-cambio-azienda')
      .set('Authorization', `Bearer ${token(consulente, aziendaStudio, 'ADMIN')}`)
      .set('X-Tenant-ID', aziendaEstranea)
      .expect(403)

    expect(osservazioni).toHaveLength(0)
  })

  // Coperto dal middleware (X-Tenant-ID del super admin), non dall'interceptor, che lascia passare SUPER_ADMIN.
  it("super admin con X-Tenant-ID: l'handler vede quell'azienda", async () => {
    const res = await request(app.getHttpServer())
      .get('/prova-cambio-azienda')
      .set('Authorization', `Bearer ${token(superAdmin, aziendaStudio, 'SUPER_ADMIN')}`)
      .set('X-Tenant-ID', aziendaEstranea)
      .expect(200)

    expect(res.body).toEqual({ store: aziendaEstranea, db: aziendaEstranea })
  })
})
