/**
 * Rotte delle ditte (F2-10, Task 4) attraverso HTTP contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE): pipe, filtro e `DitteService` veri; il login e' finto e un
 * middleware deposita l'azienda dell'header `X-Tenant-ID` nel `TenantContext`.
 *
 * Il proprietario (`wasteflow`) prepara le righe e legge cio' che e' stato scritto; la pulizia
 * toglie solo le righe delle aziende create qui, per id esatto.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { DitteController } from './ditte.controller'
import { DitteService } from '../../application/registry/ditte/ditte.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { TenantContext } from '../../core/context/tenant-context'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { DittaPrismaRepository } from '../../infrastructure/persistence/ditta-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  PIVA_CHECKSUM_ERRATO,
  creaDittaConRuolo,
  partitaIvaUnica,
} from '../../test-support/anagrafiche-di-test'

const SEDE = { via: 'Via Milano', civico: '5', cap: '20100', citta: 'Milano', provincia: 'MI' }

describe('DitteController — HTTP su Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let prisma: PrismaService
  let app: INestApplication
  let ruolo = 'OPERATOR'
  const tenantCreati: string[] = []
  let n = 0

  async function azienda(): Promise<string> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `DC${suffisso}`, ragioneSociale: 'Ditte API test SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  const http = () => request(app.getHttpServer())
  const come = (tenantId: string) => ({ 'X-Tenant-ID': tenantId })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    prisma = creaPrismaServiceApplicativo()
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [DitteController],
      providers: [
        { provide: DitteService, useValue: new DitteService(prisma, new DittaPrismaRepository()) },
        { provide: RuoloEffettivoService, useValue: { accesso: jest.fn() } },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { id: 'u1', role: ruolo }
          return true
        },
      })
      .compile()
    app = moduleRef.createNestApplication()
    app.use((req: any, _res: unknown, next: () => void) => {
      const tenantId = req.headers['x-tenant-id']
      req.tenantId = tenantId
      TenantContext.run({ tenantId }, next)
    })
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  })

  beforeEach(() => {
    ruolo = 'OPERATOR'
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
      await owner.produttore.deleteMany({ where })
      await owner.activityLog.deleteMany({ where })
      await owner.sedeDitta.deleteMany({ where })
      await owner.ditta.deleteMany({ where })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await prisma.$disconnect()
    await app?.close()
  })

  it('ciclo completo: cerca, ruolo, nuova sede, principale spostata, disattivazione', async () => {
    const t = await azienda()
    const piva = partitaIvaUnica()

    // nessuna ditta: { ditta: null }
    const vuota = await http()
      .post('/registry/ditte/cerca')
      .set(come(t))
      .send({ identificativo: piva })
    expect(vuota.status).toBe(200)
    expect(vuota.body).toEqual({ ditta: null })

    // crea il ruolo (la riga di ruolo la crea il registry: qui la fixture) e cerca di nuovo
    const {
      dittaId,
      sedeId: sede1,
      ruoloId,
    } = await creaDittaConRuolo(owner, t, 'PRODUTTORE', {
      partitaIva: piva,
      ragioneSociale: 'Bianchi SRL',
    })
    const trovata = await http()
      .post('/registry/ditte/cerca')
      .set(come(t))
      .send({ identificativo: ` it${piva} ` })
    expect(trovata.status).toBe(200)
    expect(trovata.body.ditta).toMatchObject({
      id: dittaId,
      ragioneSociale: 'Bianchi SRL',
      partitaIva: piva,
      partitaIvaDaVerificare: false,
      ruoli: { produttoreId: ruoloId },
    })
    expect(trovata.body.ditta.sedi).toHaveLength(1)

    // nuova sede (non principale)
    const nuova = await http().post(`/registry/ditte/${dittaId}/sedi`).set(come(t)).send(SEDE)
    expect(nuova.status).toBe(201)
    const sede2: string = nuova.body.id
    expect(nuova.body).toMatchObject({ citta: 'Milano', principale: false, attiva: true })

    // stesso indirizzo di nuovo: 409
    expect(
      (await http().post(`/registry/ditte/${dittaId}/sedi`).set(come(t)).send(SEDE)).status
    ).toBe(409)

    // la principale si sposta sulla seconda
    const spostata = await http()
      .post(`/registry/ditte/${dittaId}/sedi/${sede2}/principale`)
      .set(come(t))
    expect(spostata.status).toBe(200)
    expect(spostata.body.sedi.find((s: any) => s.id === sede2).principale).toBe(true)
    expect(spostata.body.sedi.find((s: any) => s.id === sede1).principale).toBe(false)

    // la prima e' ancora la predefinita del produttore: disattivazione rifiutata (409 senza id)
    const rifiutata = await http()
      .put(`/registry/ditte/${dittaId}/sedi/${sede1}`)
      .set(come(t))
      .send({ attiva: false })
    expect(rifiutata.status).toBe(409)
    expect(rifiutata.body.message).not.toContain(sede1)

    // cambio della predefinita del ruolo (come fa il PUT del registry con `sedeId`), poi consentita
    await owner.produttore.update({ where: { id: ruoloId }, data: { sedeId: sede2 } })
    const ok = await http()
      .put(`/registry/ditte/${dittaId}/sedi/${sede1}`)
      .set(come(t))
      .send({ attiva: false, telefono: '0612345' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ attiva: false, telefono: '0612345' })

    const dettaglio = await http().get(`/registry/ditte/${dittaId}`).set(come(t))
    expect(dettaglio.status).toBe(200)
    expect(dettaglio.body.sedi).toHaveLength(2)
  })

  it('sostituzione della P.IVA (D2.8): solo se quella attuale e sbagliata, con audit senza valori', async () => {
    const t = await azienda()
    const nuovaPiva = partitaIvaUnica()
    const { dittaId } = await creaDittaConRuolo(owner, t, 'PRODUTTORE', {
      partitaIva: PIVA_CHECKSUM_ERRATO,
    })
    const prima = await http().get(`/registry/ditte/${dittaId}`).set(come(t))
    expect(prima.body.partitaIvaDaVerificare).toBe(true)

    const r = await http()
      .put(`/registry/ditte/${dittaId}`)
      .set(come(t))
      .send({ ragioneSociale: 'Corretta SRL', partitaIva: nuovaPiva })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      ragioneSociale: 'Corretta SRL',
      partitaIva: nuovaPiva,
      partitaIvaDaVerificare: false,
    })
    const audit = await owner.activityLog.findMany({
      where: { tenantId: t, action: 'DITTA_PARTITA_IVA_CORRETTA' },
    })
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit[0])).not.toContain(nuovaPiva)
    expect(JSON.stringify(audit[0])).not.toContain(PIVA_CHECKSUM_ERRATO)

    // ormai valida: un'altra sostituzione e' rifiutata (400)
    const ancora = await http()
      .put(`/registry/ditte/${dittaId}`)
      .set(come(t))
      .send({ partitaIva: partitaIvaUnica() })
    expect(ancora.status).toBe(400)
  })

  it('identificativo malformato: 400 senza il valore', async () => {
    const t = await azienda()
    const r = await http()
      .post('/registry/ditte/cerca')
      .set(come(t))
      .send({ identificativo: 'ZZ-SEGRETO' })
    expect(r.status).toBe(400)
    expect(JSON.stringify(r.body)).not.toContain('SEGRETO')
  })

  it('ditta di un altra azienda: 404 su dettaglio, modifica e sedi; cerca la ignora', async () => {
    const a = await azienda()
    const b = await azienda()
    const piva = partitaIvaUnica()
    const { dittaId, sedeId } = await creaDittaConRuolo(owner, a, 'PRODUTTORE', {
      partitaIva: piva,
    })

    const nascosta = await http()
      .post('/registry/ditte/cerca')
      .set(come(b))
      .send({ identificativo: piva })
    expect(nascosta.body).toEqual({ ditta: null })
    expect((await http().get(`/registry/ditte/${dittaId}`).set(come(b))).status).toBe(404)
    expect(
      (await http().put(`/registry/ditte/${dittaId}`).set(come(b)).send({ ragioneSociale: 'X' }))
        .status
    ).toBe(404)
    expect(
      (await http().post(`/registry/ditte/${dittaId}/sedi`).set(come(b)).send(SEDE)).status
    ).toBe(404)
    expect(
      (
        await http()
          .put(`/registry/ditte/${dittaId}/sedi/${sedeId}`)
          .set(come(b))
          .send({ telefono: '1' })
      ).status
    ).toBe(404)
    expect(
      (await http().post(`/registry/ditte/${dittaId}/sedi/${sedeId}/principale`).set(come(b)))
        .status
    ).toBe(404)
    // nell'azienda giusta e' li', intatta
    const ancora = await http().get(`/registry/ditte/${dittaId}`).set(come(a))
    expect(ancora.status).toBe(200)
    expect(ancora.body.ragioneSociale).not.toBe('X')
  })

  it('un ruolo senza scrittura (VIEWER) legge ma non scrive: 403', async () => {
    const t = await azienda()
    const { dittaId } = await creaDittaConRuolo(owner, t, 'PRODUTTORE')
    ruolo = 'VIEWER'
    expect((await http().get(`/registry/ditte/${dittaId}`).set(come(t))).status).toBe(200)
    expect(
      (await http().put(`/registry/ditte/${dittaId}`).set(come(t)).send({ ragioneSociale: 'Y' }))
        .status
    ).toBe(403)
    expect(
      (await http().post(`/registry/ditte/${dittaId}/sedi`).set(come(t)).send(SEDE)).status
    ).toBe(403)
    const letta = await owner.ditta.findUnique({ where: { id: dittaId } })
    expect(letta?.ragioneSociale).not.toBe('Y')
  })
})
