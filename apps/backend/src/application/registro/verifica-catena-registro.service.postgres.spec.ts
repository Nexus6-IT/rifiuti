/**
 * Hash v2 della registrazione ordinaria e verifica della catena (R8) contro un Postgres reale,
 * collegato COME `wasteflow_app` dentro il `TenantContext` dell'azienda. Il proprietario prepara
 * i dati storici e fa gli UPDATE "a mano" che simulano un'alterazione: l'applicazione non ne ha.
 */
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { WasteMovement } from '../../domain/waste-movement/waste-movement.entity'
import { RegistraMovimentoUseCase } from './use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from './commands/registra-movimento.command'
import { RegistriService } from './registri.service'
import { VerificaCatenaRegistroService } from './verifica-catena-registro.service'
import { annoSolareItaliano } from '../../core/time/anno-italiano'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('Verifica catena del registro — Postgres reale, ruolo wasteflow_app', () => {
  const CER = '99 99 05'
  const ANNO = annoSolareItaliano(new Date())
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let useCase: RegistraMovimentoUseCase
  let verifica: VerificaCatenaRegistroService
  let cerCreato = false
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  /** Azienda con due sedi e i loro registri. */
  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `VC${suffisso}`, ragioneSociale: 'Verifica catena SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const sedi: Array<{ id: string }> = []
    for (const [i, nome] of ['Sede A', 'Sede B'].entries()) {
      sedi.push(
        await owner.rentriUnitaLocale.create({
          data: {
            tenantId: t.id,
            numIscrSito: `OP0001VC${String(++n).padStart(6, '0')}-MI0001`,
            denominazione: nome,
            principale: i === 0,
          },
        })
      )
    }
    const viste = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    const registroDi = (i: number) => viste.find(v => v.unitaLocaleId === sedi[i].id)!.id
    return { tenantId: t.id, registroA: registroDi(0), registroB: registroDi(1) }
  }

  function comando(tenantId: string, registroId: string, o: { qty?: number; data?: Date } = {}) {
    const adesso = new Date()
    return new RegistraMovimentoCommand(
      tenantId,
      undefined as unknown as string,
      'CARICO',
      o.data ?? adesso,
      adesso,
      'PRODUZIONE_INTERNA',
      CER,
      undefined,
      o.qty ?? 10,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registroId
    )
  }

  async function registra(
    tenantId: string,
    registroId: string,
    o: { qty?: number; data?: Date } = {}
  ) {
    const r = await nelTenant(tenantId, () => useCase.execute(comando(tenantId, registroId, o)))
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    return r.value
  }

  const verificaDi = (tenantId: string, registroId: string) =>
    nelTenant(tenantId, () => verifica.verifica(tenantId, registroId, ANNO))

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    registri = new RegistriService(app, loggerStub as never)
    useCase = new RegistraMovimentoUseCase(app, loggerStub as never, registri)
    verifica = new VerificaCatenaRegistroService(app)
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    cerCreato = (await owner.cERCode.count({ where: { code: CER } })) === 0
    await owner.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroProgressivoIniziale.deleteMany({
      where: { tenantId: { in: tenantCreati } },
    })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: CER } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('due registri con lo stesso numero e gli stessi dati: hash diversi', async () => {
    const az = await azienda()
    const data = new Date(Date.now() - 3_600_000)
    const a = await registra(az.tenantId, az.registroA, { data })
    const b = await registra(az.tenantId, az.registroB, { data })
    expect(a.progressiveNumber).toBe(1)
    expect(b.progressiveNumber).toBe(1)
    expect(a.entryHash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.entryHash).not.toBe(b.entryHash)
  })

  it('catena di tre registrazioni: salvate v2 e concatenate, verifica integra', async () => {
    const az = await azienda()
    for (const q of [10, 20, 5]) await registra(az.tenantId, az.registroA, { qty: q })
    const righe = await owner.wasteMovement.findMany({
      where: { registroId: az.registroA },
      orderBy: { progressiveNumber: 'asc' },
    })
    expect(righe.map(r => r.hashVersione)).toEqual([2, 2, 2])
    expect(new Set(righe.map(r => r.entryHash)).size).toBe(3)
    expect(await verificaDi(az.tenantId, az.registroA)).toEqual({
      verificate: 3,
      nonVerificabili: [],
      primoErrore: null,
    })
  })

  it('UPDATE a mano del proprietario sulla seconda riga: HASH_DIVERSO sul numero 2', async () => {
    const az = await azienda()
    for (const q of [10, 20, 5]) await registra(az.tenantId, az.registroA, { qty: q })
    await owner.wasteMovement.updateMany({
      where: { registroId: az.registroA, progressiveYear: ANNO, progressiveNumber: 2 },
      data: { quantity: 21 },
    })
    expect(await verificaDi(az.tenantId, az.registroA)).toEqual({
      verificate: 1,
      nonVerificabili: [],
      primoErrore: { numero: 2, motivo: 'HASH_DIVERSO' },
    })
  })

  it('quantita con decimali e data con millisecondi: il ricalcolo dopo la rilettura coincide', async () => {
    const az = await azienda()
    const data = new Date(Date.now() - 86_400_000)
    data.setMilliseconds(789)
    await registra(az.tenantId, az.registroA, { qty: 1234.56, data })
    await registra(az.tenantId, az.registroA, { qty: 0.07, data })
    await registra(az.tenantId, az.registroA, { qty: 99999999.99, data })
    const esito = await verificaDi(az.tenantId, az.registroA)
    expect(esito.primoErrore).toBeNull()
    expect(esito.verificate).toBe(3)
  })

  it('righe v1 storiche verificate con la v1, poi una v2 concatenata alla v1', async () => {
    const az = await azienda()
    for (const [i, q] of [100.5, 20].entries()) {
      const base = {
        tenantId: az.tenantId,
        progressiveYear: ANNO,
        progressiveNumber: i + 1,
        type: 'CARICO' as const,
        cerCode: CER,
        movementDate: new Date('2026-01-10T08:30:00.000Z'),
        causale: 'PRODUZIONE_INTERNA' as const,
      }
      await owner.wasteMovement.create({
        data: {
          ...base,
          registroId: az.registroA,
          quantity: q,
          unit: 'KG',
          entryHash: WasteMovement.computeHash({ ...base, quantity: q }),
          hashVersione: 1,
        },
      })
    }
    await registra(az.tenantId, az.registroA)
    expect(await verificaDi(az.tenantId, az.registroA)).toEqual({
      verificate: 3,
      nonVerificabili: [],
      primoErrore: null,
    })
    const v2 = await owner.wasteMovement.findFirst({
      where: { registroId: az.registroA, progressiveNumber: 3 },
    })
    expect(v2?.hashVersione).toBe(2)
  })

  it('riga con hash vuoto: nonVerificabile, non interrompe la catena', async () => {
    const az = await azienda()
    // La riga senza hash e' storica: esiste prima della successiva, che si concatena a ''.
    for (const q of [1, 2]) await registra(az.tenantId, az.registroA, { qty: q })
    await owner.wasteMovement.updateMany({
      where: { registroId: az.registroA, progressiveNumber: 2 },
      data: { entryHash: '' },
    })
    await registra(az.tenantId, az.registroA, { qty: 3 })
    expect(await verificaDi(az.tenantId, az.registroA)).toEqual({
      verificate: 2,
      nonVerificabili: [{ numero: 2, motivo: 'HASH_ASSENTE' }],
      primoErrore: null,
    })
  })

  it('un progressivo mancante: BUCO sul numero che manca', async () => {
    const az = await azienda()
    for (const q of [1, 2, 3]) await registra(az.tenantId, az.registroA, { qty: q })
    await owner.wasteMovement.deleteMany({
      where: { registroId: az.registroA, progressiveNumber: 2 },
    })
    expect(await verificaDi(az.tenantId, az.registroA)).toEqual({
      verificate: 1,
      nonVerificabili: [],
      primoErrore: { numero: 2, motivo: 'BUCO' },
    })
  })

  it('registro vuoto e versione sconosciuta', async () => {
    const az = await azienda()
    expect(await verificaDi(az.tenantId, az.registroB)).toEqual({
      verificate: 0,
      nonVerificabili: [],
      primoErrore: null,
    })
    await registra(az.tenantId, az.registroA)
    await owner.wasteMovement.updateMany({
      where: { registroId: az.registroA },
      data: { hashVersione: 9 },
    })
    expect((await verificaDi(az.tenantId, az.registroA)).primoErrore).toEqual({
      numero: 1,
      motivo: 'VERSIONE_SCONOSCIUTA',
    })
  })

  it('progressivo iniziale: se la prima riga e oltre l iniziale e un BUCO', async () => {
    const az = await azienda()
    await owner.registroProgressivoIniziale.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroA,
        anno: ANNO,
        primoProgressivo: 5,
        motivo: 'test',
        impostatoDa: randomUUID(),
      },
    })
    await registra(az.tenantId, az.registroA)
    expect((await verificaDi(az.tenantId, az.registroA)).primoErrore).toBeNull()
    await owner.registroProgressivoIniziale.updateMany({
      where: { registroId: az.registroA },
      data: { primoProgressivo: 3 },
    })
    expect((await verificaDi(az.tenantId, az.registroA)).primoErrore).toEqual({
      numero: 3,
      motivo: 'BUCO',
    })
  })
})
