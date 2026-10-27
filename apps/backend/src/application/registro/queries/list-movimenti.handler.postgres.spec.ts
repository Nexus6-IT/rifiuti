/**
 * Elenco del registro con lo stato di ogni riga (Fase 2 pezzo 3, Task 2b, R9) contro un Postgres
 * reale, COME `wasteflow_app` dentro il `TenantContext`. Le catene si costruiscono con insert
 * diretti del proprietario (`wasteflow`). Modello: `registro-per-sede.postgres.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { RegistriService } from '../registri.service'
import { ListMovimentiHandler, MovimentoListItem } from './list-movimenti.handler'
import { ListMovimentiQuery } from './list-movimenti.query'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('ListMovimentiHandler — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registri: RegistriService
  let handler: ListMovimentiHandler
  let queryRaw: jest.Mock
  const tenantCreati: string[] = []
  let n = 0
  let progressivo = 0

  type Az = { tenantId: string; registroId: string }
  type Ann = 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
  type Riga = { id: string; progressiveNumber: number }

  async function azienda(): Promise<Az> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `LM${suffisso}`, ragioneSociale: 'Elenco SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001LM${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const [registro] = await TenantContext.run({ tenantId: t.id }, () =>
      registri.assicuraRegistri(t.id)
    )
    return { tenantId: t.id, registroId: registro.id }
  }

  function inserisci(
    az: Az,
    o: {
      tipo?: Ann
      rettificato?: string
      originale?: string
      type?: 'CARICO' | 'SCARICO'
      data?: string
      cer?: string
    } = {}
  ): Promise<Riga> {
    const tipo = o.tipo ?? 'ORDINARIA'
    const corr = tipo !== 'ORDINARIA'
    const type = o.type ?? 'CARICO'
    return owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        type,
        movementDate: new Date(o.data ?? '2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'ALTRO_SCARICO',
        cerCode: o.cer ?? '99 99 04',
        quantity: 10,
        unit: 'KG',
        tipoAnnotazione: tipo,
        movimentoRettificatoId: corr ? o.rettificato : null,
        movimentoOriginaleId: corr ? o.originale : null,
        motivoAnnotazione: corr ? `motivo ${progressivo}` : null,
      },
      select: { id: true, progressiveNumber: true },
    })
  }
  const correggi = (az: Az, tipo: 'RETTIFICA' | 'ANNULLAMENTO', da: Riga, radice: Riga) =>
    inserisci(az, { tipo, rettificato: da.id, originale: radice.id })

  const elenca = (az: Az, filters = {}, pagination = { page: 1, limit: 50 }) =>
    TenantContext.run({ tenantId: az.tenantId }, async () => {
      const r = await handler.execute(new ListMovimentiQuery(az.tenantId, filters, pagination))
      return r.value
    })
  const perNumero = (items: MovimentoListItem[]) =>
    Object.fromEntries(items.map(i => [i.progressiveNumber, i]))

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    // Le query raw dell'handler passano da qui: delegano al client vero e le contiamo.
    queryRaw = jest.fn((...args: unknown[]) =>
      (app.$queryRaw as (...a: unknown[]) => unknown)(...args)
    )
    handler = new ListMovimentiHandler({
      wasteMovement: app.wasteMovement,
      $queryRaw: queryRaw,
    } as never)
  })

  beforeEach(() => queryRaw.mockClear())

  afterAll(async () => {
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('catena a 2 anelli: la rettifica e vigente, l originale e rettificato', async () => {
    const az = await azienda()
    const o = await inserisci(az)
    const r = await correggi(az, 'RETTIFICA', o, o)
    const m = perNumero((await elenca(az)).items)
    expect(m[o.progressiveNumber]).toMatchObject({
      stato: 'RETTIFICATO',
      tipoAnnotazione: 'ORDINARIA',
      correttoDa: {
        progressiveNumber: r.progressiveNumber,
        progressiveYear: 2026,
        tipoAnnotazione: 'RETTIFICA',
      },
    })
    expect(m[o.progressiveNumber].rettificaDi).toBeUndefined()
    expect(m[r.progressiveNumber]).toMatchObject({
      stato: 'VIGENTE',
      tipoAnnotazione: 'RETTIFICA',
      motivoAnnotazione: `motivo ${r.progressiveNumber}`,
      rettificaDi: {
        progressiveNumber: o.progressiveNumber,
        progressiveYear: 2026,
        tipoAnnotazione: 'ORDINARIA',
      },
    })
    expect(m[r.progressiveNumber].correttoDa).toBeUndefined()
  })

  it('catena a 3 anelli (ordinaria, rettifica, rettifica): solo la testa e vigente', async () => {
    const az = await azienda()
    const o = await inserisci(az)
    const r1 = await correggi(az, 'RETTIFICA', o, o)
    const r2 = await correggi(az, 'RETTIFICA', r1, o)
    const m = perNumero((await elenca(az)).items)
    expect([o, r1, r2].map(x => m[x.progressiveNumber].stato)).toEqual([
      'RETTIFICATO',
      'RETTIFICATO',
      'VIGENTE',
    ])
    expect(m[r1.progressiveNumber].rettificaDi?.progressiveNumber).toBe(o.progressiveNumber)
    expect(m[r1.progressiveNumber].correttoDa?.progressiveNumber).toBe(r2.progressiveNumber)
    expect(m[r2.progressiveNumber].rettificaDi?.progressiveNumber).toBe(r1.progressiveNumber)
  })

  it('catene annullate (a 2 e a 3 anelli): ogni riga, annullamento compreso, e ANNULLATA', async () => {
    const az = await azienda()
    const o = await inserisci(az)
    const a = await correggi(az, 'ANNULLAMENTO', o, o)
    const p = await inserisci(az)
    const r = await correggi(az, 'RETTIFICA', p, p)
    const b = await correggi(az, 'ANNULLAMENTO', r, p)
    const m = perNumero((await elenca(az)).items)
    for (const x of [o, a, p, r, b]) expect(m[x.progressiveNumber].stato).toBe('ANNULLATO')
    expect(m[a.progressiveNumber]).toMatchObject({
      tipoAnnotazione: 'ANNULLAMENTO',
      rettificaDi: { progressiveNumber: o.progressiveNumber },
    })
    expect(m[o.progressiveNumber].correttoDa).toMatchObject({
      progressiveNumber: a.progressiveNumber,
      tipoAnnotazione: 'ANNULLAMENTO',
    })
  })

  it('una riga ordinaria mai corretta e vigente', async () => {
    const az = await azienda()
    const o = await inserisci(az)
    const m = perNumero((await elenca(az)).items)
    expect(m[o.progressiveNumber]).toMatchObject({ stato: 'VIGENTE', tipoAnnotazione: 'ORDINARIA' })
    expect(m[o.progressiveNumber].correttoDa).toBeUndefined()
  })

  it('una sola query ricorsiva per pagina, qualunque sia il numero di catene', async () => {
    const az = await azienda()
    for (let i = 0; i < 4; i++) {
      const o = await inserisci(az)
      const r = await correggi(az, 'RETTIFICA', o, o)
      await correggi(az, 'ANNULLAMENTO', r, o)
    }
    queryRaw.mockClear()
    const pagina = await elenca(az)
    expect(pagina.items).toHaveLength(12)
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(queryRaw.mock.calls[0][0].sql).toMatch(/WITH RECURSIVE/)
  })

  it('la testa fuori dalla pagina conta: stato corretto con paginazione', async () => {
    const az = await azienda()
    // L'ordinaria e piu vecchia e l'annullamento piu recente: finiscono in pagine diverse.
    const o = await inserisci(az, { data: '2026-03-01T10:00:00Z' })
    const a = await inserisci(az, {
      tipo: 'ANNULLAMENTO',
      rettificato: o.id,
      originale: o.id,
      data: '2026-03-09T10:00:00Z',
    })
    const p1 = await elenca(az, {}, { page: 1, limit: 1 })
    const p2 = await elenca(az, {}, { page: 2, limit: 1 })
    expect(p1.items[0]).toMatchObject({
      progressiveNumber: a.progressiveNumber,
      stato: 'ANNULLATO',
    })
    expect(p2.items[0]).toMatchObject({
      progressiveNumber: o.progressiveNumber,
      stato: 'ANNULLATO',
      correttoDa: { progressiveNumber: a.progressiveNumber },
    })
    expect(p1.total).toBe(2)
    expect(p1.totalPages).toBe(2)
  })

  it('i filtri esistenti restano invariati e le non vigenti restano nell elenco', async () => {
    const az = await azienda()
    const c = await inserisci(az, { type: 'CARICO', cer: '99 99 04', data: '2026-03-01T10:00:00Z' })
    await correggi(az, 'RETTIFICA', c, c)
    const s = await inserisci(az, {
      type: 'SCARICO',
      cer: '99 99 05',
      data: '2026-04-01T10:00:00Z',
    })
    expect((await elenca(az)).total).toBe(3)
    expect((await elenca(az, { type: 'SCARICO' })).items.map(i => i.progressiveNumber)).toEqual([
      s.progressiveNumber,
    ])
    expect((await elenca(az, { type: 'CARICO' })).total).toBe(2)
    expect((await elenca(az, { cerCode: '99 99 05' })).total).toBe(1)
    expect((await elenca(az, { registroId: az.registroId })).total).toBe(3)
    expect((await elenca(az, { registroId: '00000000-0000-4000-8000-000000000000' })).total).toBe(0)
    expect(
      (await elenca(az, { dataFrom: new Date('2026-03-15T00:00:00Z') })).items.map(
        i => i.progressiveNumber
      )
    ).toEqual([s.progressiveNumber])
  })

  it('un altro tenant non vede le righe ne le catene', async () => {
    const az = await azienda()
    const altra = await azienda()
    const o = await inserisci(az)
    await correggi(az, 'ANNULLAMENTO', o, o)
    expect((await elenca(altra)).total).toBe(0)
  })
})
