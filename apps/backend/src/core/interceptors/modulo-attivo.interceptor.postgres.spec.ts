/**
 * Moduli commerciali chiusi nel backend, provati su Postgres con un'app Nest reale (T12).
 *
 * Percorso reale, dalla richiesta HTTP all'handler:
 *   TenantContextMiddleware (JWT firmato) -> JwtAuthGuard + JwtStrategy -> TenantSwitchInterceptor
 *   (MembershipService) -> ModuloAttivoInterceptor (ModuliAttiviService + ContrattoGruppoService)
 *   -> handler.
 *
 * Reali: PrismaModule, middleware, strategia JWT, guard, i DUE interceptor nell'ordine di
 * `AppModule`, servizi dei moduli, Postgres. Finto, e solo questo: RedisService (revoca ed
 * epoca di sessione) e, per il solo caso "SUPER_ADMIN senza azienda" (non costruibile con un
 * token reale: `users.tenant_id` e' NOT NULL), una guard di prova che imposta `req.user`.
 *
 * Le chiavi dei moduli dei controller di prova sono LETTE dai controller veri (FIR, PDF), cosi'
 * la prova non puo' divergere dalla mappa di produzione.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
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
import { TenantContextMiddleware } from '../middleware/tenant-context.middleware'
import { TenantSwitchInterceptor } from './tenant-switch.interceptor'
import { ModuloAttivoInterceptor } from './modulo-attivo.interceptor'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { ContrattoGruppoService } from '../../application/billing/contratto-gruppo.service'
import { MembershipService } from '../../api/me/membership.service'
import { JwtTokensService } from '../../auth/services/jwt-tokens.service'
import { JwtStrategy } from '../../auth/strategies/jwt.strategy'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RedisService } from '../../auth/services/redis.service'
import {
  RICHIEDE_MODULO,
  RichiedeModulo,
  SenzaModulo,
} from '../decorators/richiede-modulo.decorator'
import { ConsentiSelezioneNonValida } from '../decorators/consenti-selezione-non-valida.decorator'
import { FIRControllerV2 } from '../../api/fir/fir.controller.v2'
import { PdfController } from '../../api/pdf/pdf.controller'

const SEGRETO = 'segreto-di-prova-moduli-postgres'

/** Chiavi di modulo dichiarate da un metodo di un controller vero (fallisce se mancano). */
function chiaviDi(classe: { prototype: object }, metodo: string): [any, ...any[]] {
  const chiavi = Reflect.getMetadata(
    RICHIEDE_MODULO,
    (classe.prototype as Record<string, unknown>)[metodo] as object
  )
  if (!Array.isArray(chiavi) || chiavi.length === 0) {
    throw new Error(`nessun @RichiedeModulo su ${metodo}`)
  }
  return chiavi as [any, ...any[]]
}

const CHIAVI_LISTA_FIR = chiaviDi(FIRControllerV2, 'list') // fir | registro | pese | rentri
const CHIAVI_PDF_MUD = chiaviDi(PdfController, 'downloadMUD') // mud

let chiamateHandler = 0

@Controller('prova-moduli')
class ProvaModuliController {
  @Get('contratti')
  @RichiedeModulo('contratti')
  contratti() {
    chiamateHandler++
    return { ok: 'contratti' }
  }

  @Get('fir')
  @RichiedeModulo('fir')
  fir() {
    chiamateHandler++
    return { ok: 'fir' }
  }

  /** Come `GET /fir` di produzione: almeno una delle chiavi lette dal controller vero. */
  @Get('lista-fir')
  @RichiedeModulo(...CHIAVI_LISTA_FIR)
  listaFir() {
    chiamateHandler++
    return { ok: 'lista-fir' }
  }

  /** Come `GET /pdf/mud/:year`. */
  @Get('mud')
  @RichiedeModulo(...CHIAVI_PDF_MUD)
  mud() {
    chiamateHandler++
    return { ok: 'mud' }
  }

  @Get('libera')
  @SenzaModulo('rotta di base della prova')
  libera() {
    chiamateHandler++
    return { ok: 'libera' }
  }

  /** Rotta di recupero: con selezione non valida opera sull'azienda primaria. */
  @Get('recupero')
  @ConsentiSelezioneNonValida()
  @RichiedeModulo('contratti')
  recupero() {
    chiamateHandler++
    return { ok: 'recupero' }
  }
}

// Redis finto: nessuna revoca, nessuna epoca di sessione.
const redisFinto = {
  isAccessTokenRevoked: async () => false,
  leggiEpocaSessione: async () => null,
}

/**
 * Guard di prova: con `X-Prova-Super-Senza-Azienda` imposta un SUPER_ADMIN senza azienda
 * (non costruibile con un token vero); altrimenti delega alla JwtAuthGuard reale.
 */
@Injectable()
class GuardProva implements CanActivate {
  private readonly jwt = new JwtAuthGuard(
    // Reflector non serve alla prova: nessuna rotta e' @Public.
    { getAllAndOverride: () => false } as any
  )

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest()
    if (req.headers['x-prova-super-senza-azienda']) {
      req.user = { id: 'super-senza-azienda', role: 'SUPER_ADMIN', tenantId: '' }
      return true
    }
    return this.jwt.canActivate(context)
  }
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
  controllers: [ProvaModuliController],
  providers: [
    TenantContextMiddleware,
    MembershipService,
    JwtTokensService,
    JwtStrategy,
    ContrattoGruppoService,
    ModuliAttiviService,
    { provide: RedisService, useValue: redisFinto },
    { provide: APP_GUARD, useClass: GuardProva },
    // Stesso ordine di AppModule: prima la selezione dell'azienda, poi il controllo dei moduli.
    { provide: APP_INTERCEPTOR, useClass: TenantSwitchInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ModuloAttivoInterceptor },
  ],
})
class AppProvaModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*')
  }
}

describe('Moduli attivi: dal JWT all handler su Postgres', () => {
  const admin = new PrismaClient({ datasources: { db: { url: urlBase } } })
  const run = randomUUID().replace(/-/g, '')
  let app: INestApplication
  let tokens: JwtTokensService

  const tenantIds: string[] = []
  const userIds: string[] = []
  let madre = '' // PROFESSIONAL, con la figlia
  let figlia = '' // eredita dalla madre
  let trial = '' // TRIAL puro
  let soloPese = '' // TRIAL + pese - fir - registro
  let tolteContratti = '' // PROFESSIONAL - contratti
  let estranea = '' // nessuna associazione
  let studio = '' // azienda primaria del consulente
  let utenteTrial = ''
  let utenteFiglia = ''
  let utenteSoloPese = ''
  let utenteTolte = ''
  let consulente = ''
  let superAdmin = ''
  let ruoloId = ''
  let contatorePiva = 0
  let contatoreUtenti = 0

  const nuovaPiva = () => {
    contatorePiva += 1
    return String(Number(`${Date.now()}`.slice(-9)) * 100 + contatorePiva)
      .slice(-11)
      .padStart(11, '5')
  }

  async function creaAzienda(
    nome: string,
    dati: {
      tier?: 'TRIAL' | 'PROFESSIONAL' | 'ENTERPRISE'
      featureFlags?: string[]
      featureTolte?: string[]
      parentTenantId?: string
    } = {}
  ): Promise<string> {
    const t = await admin.tenant.create({
      data: {
        partitaIva: nuovaPiva(),
        ragioneSociale: `${nome} ${run}`,
        subscriptionTier: dati.tier ?? 'TRIAL',
        featureFlags: dati.featureFlags,
        featureTolte: dati.featureTolte,
        parentTenantId: dati.parentTenantId,
      },
    })
    tenantIds.push(t.id)
    return t.id
  }

  async function creaUtente(tenantId: string, ruolo: 'ADMIN' | 'SUPER_ADMIN', nome: string) {
    const u = await admin.user.create({
      data: {
        tenantId,
        email: `${nome}-${run}@example.it`,
        fiscalCode: `TSTMOD00A00A${String(100 + contatoreUtenti++)}Z`,
        firstName: 'Prova',
        lastName: nome,
        role: ruolo,
        keycloakId: `kc-${nome}-${run}`,
      },
    })
    userIds.push(u.id)
    return u.id
  }

  const token = (utenteId: string, tenantId: string, role = 'ADMIN') =>
    tokens.generateAccessToken({ id: utenteId, email: 'x@example.it', tenantId, role })

  const get = (percorso: string, tk: string, azienda?: string) => {
    const r = request(app.getHttpServer())
      .get(`/prova-moduli/${percorso}`)
      .set('Authorization', `Bearer ${tk}`)
    return azienda ? r.set('X-Tenant-ID', azienda) : r
  }

  beforeAll(async () => {
    madre = await creaAzienda('Madre Pro', { tier: 'PROFESSIONAL' })
    figlia = await creaAzienda('Figlia', { tier: 'TRIAL', parentTenantId: madre })
    trial = await creaAzienda('Trial')
    soloPese = await creaAzienda('Solo Pese', {
      tier: 'TRIAL',
      featureFlags: ['pese'],
      featureTolte: ['fir', 'registro'],
    })
    tolteContratti = await creaAzienda('Pro Senza Contratti', {
      tier: 'PROFESSIONAL',
      featureTolte: ['contratti'],
    })
    estranea = await creaAzienda('Estranea', { tier: 'ENTERPRISE' })
    studio = await creaAzienda('Studio', { tier: 'ENTERPRISE' })

    utenteTrial = await creaUtente(trial, 'ADMIN', 'utente-trial')
    utenteFiglia = await creaUtente(figlia, 'ADMIN', 'utente-figlia')
    utenteSoloPese = await creaUtente(soloPese, 'ADMIN', 'utente-solo-pese')
    utenteTolte = await creaUtente(tolteContratti, 'ADMIN', 'utente-tolte')
    consulente = await creaUtente(studio, 'ADMIN', 'consulente')
    superAdmin = await creaUtente(studio, 'SUPER_ADMIN', 'super')

    const ruolo = await admin.role.create({
      data: { tenantId: trial, name: `CONSULTANT-${run}`, createdBy: consulente },
    })
    ruoloId = ruolo.id
    await admin.consultantTenantAssociation.create({
      data: { consultantUserId: consulente, tenantId: trial, roleId: ruoloId, addedBy: consulente },
    })

    const modulo = await Test.createTestingModule({ imports: [AppProvaModule] }).compile()
    app = modulo.createNestApplication()
    await app.init()
    tokens = app.get(JwtTokensService)
  })

  afterAll(async () => {
    if (app) await app.close()
    // Solo righe create da questo test, per id esatti.
    await admin.consultantTenantAssociation.deleteMany({
      where: { consultantUserId: { in: userIds } },
    })
    if (ruoloId) await admin.role.deleteMany({ where: { id: ruoloId } })
    await admin.user.deleteMany({ where: { id: { in: userIds } } })
    // La figlia prima della madre (riferimento parentTenantId).
    await admin.tenant.deleteMany({ where: { id: figlia } })
    await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await admin.$disconnect()
  })

  beforeEach(() => {
    chiamateHandler = 0
  })

  it('le chiavi lette dai controller veri sono quelle attese (la prova non diverge)', () => {
    expect([...CHIAVI_LISTA_FIR].sort()).toEqual(['fir', 'pese', 'registro', 'rentri'])
    expect(CHIAVI_PDF_MUD).toEqual(['mud'])
  })

  describe('piano, madre e figlia', () => {
    it('TRIAL: modulo del piano 200, modulo fuori piano 403 MODULO_NON_ATTIVO e handler non chiamato', async () => {
      await get('fir', token(utenteTrial, trial)).expect(200)
      chiamateHandler = 0
      const res = await get('contratti', token(utenteTrial, trial)).expect(403)
      expect(res.body).toMatchObject({
        error: 'MODULO_NON_ATTIVO',
        details: { moduli: ['contratti'] },
      })
      expect(chiamateHandler).toBe(0)
    })

    it('la figlia TRIAL eredita i moduli della madre PROFESSIONAL', async () => {
      await get('contratti', token(utenteFiglia, figlia)).expect(200)
      await get('mud', token(utenteFiglia, figlia)).expect(200)
    })

    it('la figlia perde il modulo se la madre lo perde (e lo riacquista), senza riavvio', async () => {
      await admin.tenant.update({ where: { id: madre }, data: { featureTolte: ['contratti'] } })
      try {
        await get('contratti', token(utenteFiglia, figlia)).expect(403)
        await get('fir', token(utenteFiglia, figlia)).expect(200)
      } finally {
        await admin.tenant.update({ where: { id: madre }, data: { featureTolte: [] } })
      }
      await get('contratti', token(utenteFiglia, figlia)).expect(200)
    })

    it('featureTolte prevale sul piano', async () => {
      const tk = token(utenteTolte, tolteContratti)
      await get('contratti', tk).expect(403)
      await get('mud', tk).expect(200) // il resto del piano PROFESSIONAL resta
    })

    it('featureTolte prevale anche su featureFlags della stessa azienda', async () => {
      const t = await creaAzienda('Flag e tolta', {
        tier: 'TRIAL',
        featureFlags: ['contratti'],
        featureTolte: ['contratti'],
      })
      const u = await creaUtente(t, 'ADMIN', 'utente-flag-tolta')
      await get('contratti', token(u, t)).expect(403)
    })

    it('un cambio di piano vale dalla richiesta successiva, senza riavvio', async () => {
      const tk = token(utenteTrial, trial)
      await get('contratti', tk).expect(403)
      await admin.tenant.update({
        where: { id: trial },
        data: { subscriptionTier: 'PROFESSIONAL' },
      })
      try {
        await get('contratti', tk).expect(200)
      } finally {
        await admin.tenant.update({ where: { id: trial }, data: { subscriptionTier: 'TRIAL' } })
      }
      await get('contratti', tk).expect(403)
    })

    it('un modulo aggiunto con featureFlags vale subito, e toglierlo lo richiude', async () => {
      const tk = token(utenteTrial, trial)
      await admin.tenant.update({ where: { id: trial }, data: { featureFlags: ['mud'] } })
      try {
        await get('mud', tk).expect(200)
      } finally {
        await admin.tenant.update({ where: { id: trial }, data: { featureFlags: [] } })
      }
      await get('mud', tk).expect(403)
    })

    it('la rotta di base passa per qualunque azienda', async () => {
      await get('libera', token(utenteTrial, trial)).expect(200)
    })
  })

  describe('letture trasversali «almeno una delle chiavi»', () => {
    it('lista FIR con la sola chiave pese: 200 (fir e registro tolti)', async () => {
      const tk = token(utenteSoloPese, soloPese)
      await get('lista-fir', tk).expect(200)
      // ...ma il modulo fir in senso stretto resta chiuso
      const res = await get('fir', tk).expect(403)
      expect(res.body.details.moduli).toEqual(['fir'])
    })

    it('lista FIR senza nessuna delle chiavi: 403 con tutte le chiavi accettate in details', async () => {
      // Azienda con tutto tolto tranne anagrafiche.
      const t = await creaAzienda('Solo Anagrafiche', {
        tier: 'TRIAL',
        featureTolte: ['fir', 'cer', 'registro'],
      })
      const u = await creaUtente(t, 'ADMIN', 'utente-solo-anagrafiche')
      const res = await get('lista-fir', token(u, t)).expect(403)
      expect([...res.body.details.moduli].sort()).toEqual(['fir', 'pese', 'registro', 'rentri'])
    })
  })

  describe('consulente con X-Tenant-ID', () => {
    it('cliente TRIAL: il modulo che manca al cliente da 403 MODULO_NON_ATTIVO, anche se lo studio e ENTERPRISE', async () => {
      const res = await get('contratti', token(consulente, studio), trial).expect(403)
      expect(res.body.error).toBe('MODULO_NON_ATTIVO')
      expect(chiamateHandler).toBe(0)
      // Senza header vale lo studio (ENTERPRISE).
      await get('contratti', token(consulente, studio)).expect(200)
      // Con header, un modulo del piano del cliente passa.
      await get('fir', token(consulente, studio), trial).expect(200)
    })

    it('il cliente che passa a PROFESSIONAL apre il modulo al consulente alla richiesta dopo', async () => {
      await get('contratti', token(consulente, studio), trial).expect(403)
      await admin.tenant.update({
        where: { id: trial },
        data: { subscriptionTier: 'PROFESSIONAL' },
      })
      try {
        await get('contratti', token(consulente, studio), trial).expect(200)
      } finally {
        await admin.tenant.update({ where: { id: trial }, data: { subscriptionTier: 'TRIAL' } })
      }
    })

    it('azienda non accessibile: AZIENDA_SELEZIONATA_NON_ACCESSIBILE e nessuna informazione sui moduli', async () => {
      const res = await get('contratti', token(consulente, studio), estranea).expect(403)
      expect(res.body.error).toBe('AZIENDA_SELEZIONATA_NON_ACCESSIBILE')
      expect(res.body.details).toBeUndefined()
      expect(JSON.stringify(res.body)).not.toContain('moduli')
      expect(chiamateHandler).toBe(0)
      // Identico per un'azienda inesistente (nessuna enumerazione).
      const inesistente = await get('contratti', token(consulente, studio), randomUUID()).expect(
        403
      )
      expect(inesistente.body).toEqual(res.body)
    })

    it('rotta di recupero con azienda non accessibile: il controllo moduli vale sulla primaria', async () => {
      // Primaria dello studio: ENTERPRISE, ha contratti -> passa.
      await get('recupero', token(consulente, studio), estranea).expect(200)
      // Primaria TRIAL senza contratti -> 403 sulla primaria, non sull'azienda richiesta.
      const res = await get('recupero', token(utenteTrial, trial), studio).expect(403)
      expect(res.body.error).toBe('MODULO_NON_ATTIVO')
    })
  })

  describe('SUPER_ADMIN (D2b)', () => {
    it('con X-Tenant-ID valgono i moduli dell azienda scelta', async () => {
      const tk = token(superAdmin, studio, 'SUPER_ADMIN')
      const res = await get('contratti', tk, trial).expect(403)
      expect(res.body.error).toBe('MODULO_NON_ATTIVO')
      await get('fir', tk, trial).expect(200)
      await get('contratti', tk, madre).expect(200)
    })

    it('senza header valgono i moduli della sua azienda (ENTERPRISE: tutto)', async () => {
      const tk = token(superAdmin, studio, 'SUPER_ADMIN')
      await get('contratti', tk).expect(200)
      await get('mud', tk).expect(200)
    })

    it('senza nessuna azienda (contesto di piattaforma) passa su ogni rotta di modulo', async () => {
      await request(app.getHttpServer())
        .get('/prova-moduli/contratti')
        .set('X-Prova-Super-Senza-Azienda', '1')
        .expect(200)
      expect(chiamateHandler).toBe(1)
    })
  })

  describe('fail-closed', () => {
    it('senza token una rotta di modulo non passa (401)', async () => {
      await request(app.getHttpServer()).get('/prova-moduli/fir').expect(401)
      expect(chiamateHandler).toBe(0)
    })

    it('azienda del token inesistente nel database: nessun modulo, 403', async () => {
      const res = await get('fir', token(utenteTrial, randomUUID())).expect(403)
      expect(res.body.error).toBe('MODULO_NON_ATTIVO')
    })
  })
})
