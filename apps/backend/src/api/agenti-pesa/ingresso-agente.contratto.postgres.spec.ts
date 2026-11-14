/**
 * Contratto Go <-> backend contro la rotta VERA: il payload e la firma di
 * `tools/agente-pesa/testdata/contratto/lettura-v1.json` (generati dal client Go) arrivano a
 * `POST /agenti-pesa/letture` con guard, servizio e database reali (ruolo `wasteflow_app`, RLS) e
 * vengono ACCETTATI. Se il formato cambia da una parte sola, questo test (o quello Go) fallisce.
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo, urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55444/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { readFileSync } from 'fs'
import { join } from 'path'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { AbbinamentoAgenteService } from '../../application/pese/agenti/abbinamento-agente.service'
import { BattitoAgenteService } from '../../application/pese/agenti/battito-agente.service'
import { IngressoLettureService } from '../../application/pese/agenti/ingresso-letture.service'
import { RisoluzioneAgenteService } from '../../application/pese/agenti/risoluzione-agente.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { hashSegreto } from '../../domain/pese/agenti/credenziali-agente'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { AgentePesaGuard } from './agente-pesa.guard'
import { IngressoAgenteController } from './ingresso-agente.controller'
import { ThrottlerAbbinamentoGuard } from './throttler-abbinamento.guard'
import { ThrottlerAgenteGuard } from './throttler-agente.guard'
import { FallimentiAutenticazione } from './fallimenti-autenticazione'

interface Contratto {
  chiavePubblicaB64: string
  payloadB64: string
  firmaB64: string
}

describe('Contratto lettura-v1.json contro POST /agenti-pesa/letture (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
    urlProprietario
  )
  const contratto = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        '..',
        '..',
        'tools',
        'agente-pesa',
        'testdata',
        'contratto',
        'lettura-v1.json'
      ),
      'utf8'
    )
  ) as Contratto
  const payload = JSON.parse(Buffer.from(contratto.payloadB64, 'base64').toString('utf8')) as {
    agenteId: string
    strumentoId: string
    chiaveIdempotenza: string
  }
  const TOKEN = `wfpa_${'K'.repeat(43)}`
  let app: INestApplication
  let prisma: PrismaService
  let tenantId: string

  beforeAll(async () => {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(9_950_000 + (Date.now() % 40_000)),
        ragioneSociale: 'Contratto SRL',
        country: 'IT',
        peseSimulazioneAmmessa: true,
      },
    })
    tenantId = t.id
    const u = await owner.user.create({
      data: {
        tenantId,
        keycloakId: `kc-contratto-${Date.now()}`,
        fiscalCode: `CTR${Date.now()}`.slice(0, 16),
        firstName: 'Prova',
        lastName: 'Contratto',
        email: `contratto-${Date.now()}@example.test`,
        role: 'ADMIN',
      },
    })
    const reg = await owner.registroRifiuti.create({
      data: { tenantId, descrizione: 'Registro A', codice: 'A' },
    })
    await owner.agentePesa.create({
      data: {
        id: payload.agenteId,
        tenantId,
        registroId: reg.id,
        descrizione: 'PC contratto',
        stato: 'ATTIVO',
        tokenSha256: hashSegreto(TOKEN),
        chiavePubblica: contratto.chiavePubblicaB64,
        improntaChiave: 'f'.repeat(64),
        abbinatoIl: new Date(),
        creatoDa: u.id,
      },
    })
    await owner.strumentoPesa.create({
      data: {
        id: payload.strumentoId,
        tenantId,
        registroId: reg.id,
        descrizione: 'Pesa contratto',
        agenteId: payload.agenteId,
        creatoDa: u.id,
      },
    })

    prisma = creaPrismaServiceApplicativo()
    await prisma.onModuleInit()
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }])],
      controllers: [IngressoAgenteController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: PrismaSistemaService, useValue: sistema },
        RisoluzioneAgenteService,
        AbbinamentoAgenteService,
        IngressoLettureService,
        BattitoAgenteService,
        { provide: ModuliAttiviService, useValue: { moduliAttivi: async () => ['pese'] } },
        AgentePesaGuard,
        ThrottlerAgenteGuard,
        ThrottlerAbbinamentoGuard,
        FallimentiAutenticazione,
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
    if (tenantId) await owner.tenant.deleteMany({ where: { id: tenantId } })
    await Promise.all([owner.$disconnect(), sistema.$disconnect(), prisma?.$disconnect()])
  })

  const invia = () =>
    request(app.getHttpServer())
      .post('/agenti-pesa/letture')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ letture: [{ payload: contratto.payloadB64, firma: contratto.firmaB64 }] })

  it('il payload e la firma generati dal client Go sono ACCETTATI e conservati byte per byte', async () => {
    const r = await invia().expect(200)

    expect(r.body.esiti).toHaveLength(1)
    expect(r.body.esiti[0]).toMatchObject({
      chiaveIdempotenza: payload.chiaveIdempotenza,
      esito: 'ACCETTATA',
    })
    const riga = await owner.letturaPesa.findUniqueOrThrow({
      where: { id: r.body.esiti[0].letturaId },
    })
    expect(Buffer.from(riga.payload, 'utf8').toString('base64')).toBe(contratto.payloadB64)
    expect(riga.firma).toBe(contratto.firmaB64)
    expect(riga).toMatchObject({ simulata: true, driver: 'SIMULATA', alibiId: 'SIM-000041' })
    expect(Number(riga.pesoKg)).toBe(12340)
  })

  it('la stessa lettura ritrasmessa (coda dell’agente) è GIA_RICEVUTA, una sola riga', async () => {
    const r = await invia().expect(200)
    expect(r.body.esiti[0].esito).toBe('GIA_RICEVUTA')
    expect(await owner.letturaPesa.count({ where: { agenteId: payload.agenteId } })).toBe(1)
  })
})
