/**
 * Vigenza e vincoli delle correzioni (Fase 2 pezzo 3, Task 1a) contro un Postgres reale, letti COME
 * `wasteflow_app` dentro il `TenantContext` (RLS ENABLE+FORCE). Le catene si costruiscono con insert
 * diretti del proprietario (`wasteflow`): il caso d'uso di correzione arriva piu' avanti.
 */
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

import { Prisma } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { WHERE_VIGENTE, sqlVigente } from './vigenza'

describe('Vigenza e vincoli delle correzioni — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `VG${suffisso}`, ragioneSociale: 'Vigenza SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const registri = []
    for (let i = 0; i < 2; i++) {
      const u = await owner.rentriUnitaLocale.create({
        data: {
          tenantId: t.id,
          numIscrSito: `OP0001VG${String(++n).padStart(6, '0')}-MI0001`,
          denominazione: `Sede ${i}`,
          principale: i === 0,
        },
      })
      registri.push(
        await owner.registroRifiuti.create({
          data: { tenantId: t.id, unitaLocaleId: u.id, descrizione: `Registro sede ${i}` },
        })
      )
    }
    return { tenantId: t.id, registroA: registri[0].id, registroB: registri[1].id }
  }

  let progressivo = 0
  type Ann = 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
  /** Inserisce una annotazione (proprietario); i riferimenti vanno passati coerenti col CHECK. */
  function inserisci(
    az: { tenantId: string; registroA: string },
    o: {
      tipo?: Ann
      rettificato?: string
      originale?: string
      motivo?: string | null
      registroId?: string
      type?: 'CARICO' | 'SCARICO'
      tenantId?: string
      quantita?: number
    } = {}
  ) {
    const tipo = o.tipo ?? 'ORDINARIA'
    const corr = tipo !== 'ORDINARIA'
    return owner.wasteMovement.create({
      data: {
        tenantId: o.tenantId ?? az.tenantId,
        registroId: o.registroId ?? az.registroA,
        progressiveYear: 2026,
        progressiveNumber: ++progressivo,
        type: o.type ?? 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        cerCode: '99 99 04',
        quantity: o.quantita ?? 10,
        unit: 'KG',
        tipoAnnotazione: tipo,
        movimentoRettificatoId: corr ? (o.rettificato ?? null) : null,
        movimentoOriginaleId: corr ? (o.originale ?? null) : null,
        motivoAnnotazione: corr
          ? o.motivo === undefined
            ? 'errore di battitura'
            : o.motivo
          : null,
      },
    })
  }

  /** Tre catene: A (ord->ret->ret), B (ord->annull), C (ord->ret->annull), D (ord isolata). */
  async function costruisciCatene() {
    const az = await azienda()
    const a0 = await inserisci(az)
    const a1 = await inserisci(az, { tipo: 'RETTIFICA', rettificato: a0.id, originale: a0.id })
    const a2 = await inserisci(az, { tipo: 'RETTIFICA', rettificato: a1.id, originale: a0.id })
    const b0 = await inserisci(az)
    const b1 = await inserisci(az, { tipo: 'ANNULLAMENTO', rettificato: b0.id, originale: b0.id })
    const c0 = await inserisci(az)
    const c1 = await inserisci(az, { tipo: 'RETTIFICA', rettificato: c0.id, originale: c0.id })
    const c2 = await inserisci(az, { tipo: 'ANNULLAMENTO', rettificato: c1.id, originale: c0.id })
    const d0 = await inserisci(az)
    return { az, a0, a1, a2, b0, b1, c0, c1, c2, d0 }
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  describe('vigenza', () => {
    it('WHERE_VIGENTE e sqlVigente danno le stesse teste (solo a2 e d0)', async () => {
      const { az, a2, d0 } = await costruisciCatene()
      const attese = [a2.id, d0.id].sort()

      const viaPrisma = await nelTenant(az.tenantId, () =>
        app.wasteMovement.findMany({ where: { ...WHERE_VIGENTE }, select: { id: true } })
      )
      expect(viaPrisma.map(r => r.id).sort()).toEqual(attese)

      const viaSql = await nelTenant(az.tenantId, () =>
        app.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT m.id FROM waste_movements m WHERE ${sqlVigente('m')}`
        )
      )
      expect(viaSql.map(r => r.id).sort()).toEqual(attese)
    })

    it('WHERE_VIGENTE funziona anche in un groupBy', async () => {
      const { az } = await costruisciCatene()
      const g = await nelTenant(az.tenantId, () =>
        app.wasteMovement.groupBy({
          by: ['cerCode'],
          where: { ...WHERE_VIGENTE },
          _sum: { quantity: true },
          _count: { _all: true },
        })
      )
      // a2 e d0, 10 kg ciascuna
      expect(g).toHaveLength(1)
      expect(g[0]._count._all).toBe(2)
      expect(g[0]._sum.quantity?.toString()).toBe('20')
    })

    it('sqlVigente non confligge con un alias a sua volta chiamato c', async () => {
      const { az, a2, d0 } = await costruisciCatene()
      const r = await nelTenant(az.tenantId, () =>
        app.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT c.id FROM waste_movements c WHERE ${sqlVigente('c')}`
        )
      )
      expect(r.map(x => x.id).sort()).toEqual([a2.id, d0.id].sort())
    })
  })

  describe('vincoli', () => {
    it('una correzione in un altro registro e respinta', async () => {
      const az = await azienda()
      const o = await inserisci(az)
      await expect(
        inserisci(az, {
          tipo: 'RETTIFICA',
          rettificato: o.id,
          originale: o.id,
          registroId: az.registroB,
        })
      ).rejects.toThrow(/waste_movements_rettificato_fkey|Foreign key/i)
    })

    it('una correzione di un altro tipo (CARICO/SCARICO) e respinta', async () => {
      const az = await azienda()
      const o = await inserisci(az, { type: 'CARICO' })
      await expect(
        inserisci(az, { tipo: 'RETTIFICA', rettificato: o.id, originale: o.id, type: 'SCARICO' })
      ).rejects.toThrow(/waste_movements_rettificato_fkey|Foreign key/i)
    })

    it('una correzione che punta a una riga di un altra azienda e respinta', async () => {
      const az = await azienda()
      const altra = await azienda()
      const estranea = await inserisci(altra)
      await expect(
        inserisci(az, { tipo: 'RETTIFICA', rettificato: estranea.id, originale: estranea.id })
      ).rejects.toThrow(/waste_movements_rettificato_fkey|Foreign key/i)
    })

    it('anche la radice e vincolata (altro registro respinto)', async () => {
      const az = await azienda()
      const o = await inserisci(az)
      const altraRadice = await inserisci(az, { registroId: az.registroB })
      await expect(
        inserisci(az, { tipo: 'RETTIFICA', rettificato: o.id, originale: altraRadice.id })
      ).rejects.toThrow(/waste_movements_originale_fkey|Foreign key/i)
    })

    it('una seconda correzione dello stesso predecessore e respinta', async () => {
      const az = await azienda()
      const o = await inserisci(az)
      await inserisci(az, { tipo: 'RETTIFICA', rettificato: o.id, originale: o.id })
      await expect(
        inserisci(az, { tipo: 'ANNULLAMENTO', rettificato: o.id, originale: o.id })
      ).rejects.toThrow(/waste_movements_movimento_rettificato_id_key|Unique constraint/i)
    })

    it('CHECK: motivo vuoto o di soli spazi respinto, ordinaria con riferimento respinta', async () => {
      const az = await azienda()
      const o = await inserisci(az)
      for (const motivo of ['', '   ']) {
        await expect(
          inserisci(az, { tipo: 'RETTIFICA', rettificato: o.id, originale: o.id, motivo })
        ).rejects.toThrow(/waste_movements_annotazione_coerente|check constraint/i)
      }
      await expect(
        inserisci(az, { tipo: 'RETTIFICA', rettificato: o.id, originale: o.id, motivo: null })
      ).rejects.toThrow(/waste_movements_annotazione_coerente|check constraint/i)
      // ordinaria con un riferimento (SQL diretto: il helper azzera i riferimenti delle ordinarie)
      await expect(
        owner.$executeRaw`UPDATE waste_movements SET movimento_rettificato_id = ${o.id}::uuid WHERE id = ${o.id}::uuid`
      ).rejects.toThrow(
        /waste_movements_annotazione_coerente|waste_movements_non_corregge_se_stessa|check constraint/i
      )
      const altra = await inserisci(az)
      await expect(
        owner.$executeRaw`UPDATE waste_movements SET movimento_originale_id = ${o.id}::uuid WHERE id = ${altra.id}::uuid`
      ).rejects.toThrow(/waste_movements_annotazione_coerente|check constraint/i)
    })

    it('CHECK: una riga non corregge se stessa', async () => {
      const az = await azienda()
      const o = await inserisci(az)
      await expect(
        owner.$executeRaw`UPDATE waste_movements SET tipo_annotazione = 'RETTIFICA', movimento_rettificato_id = id, movimento_originale_id = id, motivo_annotazione = 'x' WHERE id = ${o.id}::uuid`
      ).rejects.toThrow(/waste_movements_non_corregge_se_stessa|check constraint/i)
    })

    it('la cancellazione in blocco di una catena in un solo statement riesce', async () => {
      const { az } = await costruisciCatene()
      const r = await owner.wasteMovement.deleteMany({ where: { tenantId: az.tenantId } })
      expect(r.count).toBe(9)
      expect(await owner.wasteMovement.count({ where: { tenantId: az.tenantId } })).toBe(0)
    })
  })
})
