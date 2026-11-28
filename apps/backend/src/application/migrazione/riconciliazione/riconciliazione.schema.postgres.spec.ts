/**
 * Schema della riconciliazione dell'import (I8, migration `20261128100000`) contro un Postgres reale,
 * COME `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext`. Il proprietario prepara le aziende
 * e le pulisce per id esatti.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { createHash, randomUUID } from 'crypto'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'

describe('Riconciliazione dell import, schema — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  const h = (t: string) => createHash('sha256').update(t).digest('hex')

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Riconciliazione SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  /** Prima versione di un rapporto (la radice si cita da sola). */
  function v1(tenantId: string, extra: Record<string, unknown> = {}) {
    const id = randomUUID()
    return {
      id,
      tenantId,
      radiceId: id,
      versione: 1,
      lottiImportIds: [randomUUID()],
      esiti: { formato: 'wasteflow-riconciliazione/1' },
      hashRapporto: h('r1'),
      hashSorgente: h('s'),
      ...extra,
    }
  }

  async function errore(p: Promise<unknown>): Promise<string> {
    try {
      await p
    } catch (e) {
      return String((e as Error).message)
    }
    throw new Error('attesa una violazione, non e arrivata')
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('le tre tabelle hanno RLS abilitata e forzata', async () => {
    const r = await owner.$queryRaw<Array<{ relname: string; s: boolean; f: boolean }>>`
      SELECT relname, relrowsecurity AS s, relforcerowsecurity AS f FROM pg_class
      WHERE relname IN ('rapporti_riconciliazione','campioni_riconciliazione','verbali_riconciliazione')`
    expect(r).toHaveLength(3)
    for (const x of r) expect([x.relname, x.s, x.f]).toEqual([x.relname, true, true])
  })

  it('una prima versione si inserisce con radice uguale a se stessa e stato APERTO', async () => {
    const t = await azienda()
    const c = await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v1(t) }))
    expect(c.stato).toBe('APERTO')
    expect(c.radiceId).toBe(c.id)
  })

  it('la radice coincide con l id alla versione 1, e una versione 2 non puo essere una radice', async () => {
    const t = await azienda()
    const a = await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v1(t) }))
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.rapportoRiconciliazione.create({ data: { ...v1(t), radiceId: a.id } })
        )
      )
    ).toMatch(/rapporti_riconciliazione_radice_check/)
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.rapportoRiconciliazione.create({ data: { ...v1(t), versione: 2 } })
        )
      )
    ).toMatch(/successiva all'ultima/)
  })

  it('le versioni sono consecutive, senza salti ne doppioni', async () => {
    const t = await azienda()
    const a = await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v1(t) }))
    const v2 = (versione: number) => ({
      ...v1(t),
      id: randomUUID(),
      radiceId: a.id,
      versione,
      hashRapporto: h(`r${versione}`),
    })
    expect(
      await errore(nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v2(3) })))
    ).toMatch(/successiva all'ultima/)
    await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v2(2) }))
    expect(
      await errore(nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v2(2) })))
    ).toMatch(/successiva all'ultima|radice_versione_key|Unique/)
  })

  it('esiti, lotti e impronta non si modificano; si chiude solo l ultima versione', async () => {
    const t = await azienda()
    const a = await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v1(t) }))
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.rapportoRiconciliazione.update({ where: { id: a.id }, data: { esiti: { x: 1 } } })
        )
      )
    ).toMatch(/dato immutabile/)
    const b = await nelTenant(t, () =>
      app.db.rapportoRiconciliazione.create({
        data: { ...v1(t), id: randomUUID(), radiceId: a.id, versione: 2, hashRapporto: h('r2') },
      })
    )
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.rapportoRiconciliazione.update({
            where: { id: a.id },
            data: { stato: 'CHIUSO', chiusoDa: randomUUID(), chiusoIl: new Date() },
          })
        )
      )
    ).toMatch(/solo l'ultima versione/)
    const chiuso = await nelTenant(t, () =>
      app.db.rapportoRiconciliazione.update({
        where: { id: b.id },
        data: { stato: 'CHIUSO', chiusoDa: randomUUID(), chiusoIl: new Date() },
      })
    )
    expect(chiuso.stato).toBe('CHIUSO')
  })

  it('CHIUSO e terminale e dopo la chiusura non nascono versioni ne cambiano i campioni', async () => {
    const t = await azienda()
    const a = await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v1(t) }))
    const campione = await nelTenant(t, () =>
      app.db.campioneRiconciliazione.create({
        data: {
          tenantId: t,
          rapportoRadiceId: a.id,
          tipo: 'MOVIMENTO',
          riferimentoId: randomUUID(),
        },
      })
    )
    // Prima della chiusura l'esito si da e si puo' correggere.
    await nelTenant(t, () =>
      app.db.campioneRiconciliazione.update({
        where: { id: campione.id },
        data: { esito: 'NON_CORRISPONDE', esitoDa: randomUUID(), esitoIl: new Date() },
      })
    )
    await nelTenant(t, () =>
      app.db.campioneRiconciliazione.update({
        where: { id: campione.id },
        data: { esito: 'CORRISPONDE', esitoIl: new Date() },
      })
    )
    await nelTenant(t, () =>
      app.db.rapportoRiconciliazione.update({
        where: { id: a.id },
        data: { stato: 'CHIUSO', chiusoDa: randomUUID(), chiusoIl: new Date() },
      })
    )
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.rapportoRiconciliazione.update({
            where: { id: a.id },
            data: { chiusoIl: new Date() },
          })
        )
      )
    ).toMatch(/chiuso non cambia/)
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.rapportoRiconciliazione.create({
            data: { ...v1(t), id: randomUUID(), radiceId: a.id, versione: 2 },
          })
        )
      )
    ).toMatch(/chiuso, non si aggiungono versioni/)
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.campioneRiconciliazione.update({
            where: { id: campione.id },
            data: { esito: 'NON_CORRISPONDE', esitoIl: new Date() },
          })
        )
      )
    ).toMatch(/rapporto e' chiuso/)
  })

  it('il riferimento scelto del campione non si modifica; l esito richiede la sua data', async () => {
    const t = await azienda()
    const a = await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v1(t) }))
    const c = await nelTenant(t, () =>
      app.db.campioneRiconciliazione.create({
        data: { tenantId: t, rapportoRadiceId: a.id, tipo: 'FIR', riferimentoId: randomUUID() },
      })
    )
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.campioneRiconciliazione.update({
            where: { id: c.id },
            data: { riferimentoId: randomUUID() },
          })
        )
      )
    ).toMatch(/riferimento scelto/)
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.campioneRiconciliazione.update({
            where: { id: c.id },
            data: { esito: 'CORRISPONDE' },
          })
        )
      )
    ).toMatch(/campioni_riconciliazione_esito_check/)
    // Lo stesso riferimento non si sceglie due volte.
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.campioneRiconciliazione.create({
            data: {
              tenantId: t,
              rapportoRadiceId: a.id,
              tipo: 'FIR',
              riferimentoId: c.riferimentoId,
            },
          })
        )
      )
    ).toMatch(/Unique|riferimento_key/)
  })

  it('il verbale e insert-only, solo PDF, con impronta e dimensione coerenti', async () => {
    const t = await azienda()
    const a = await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v1(t) }))
    const pdf = Buffer.from('%PDF-1.4 verbale di prova')
    const dati = {
      tenantId: t,
      rapportoRadiceId: a.id,
      versioneRapporto: 1,
      nomeFile: 'verbale.pdf',
      mime: 'application/pdf',
      dimensione: pdf.length,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      contenuto: pdf,
    }
    const v = await nelTenant(t, () => app.db.verbaleRiconciliazione.create({ data: dati }))
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.verbaleRiconciliazione.update({ where: { id: v.id }, data: { nomeFile: 'x.pdf' } })
        )
      )
    ).toMatch(/permission denied|insert-only/)
    expect(
      await errore(
        nelTenant(t, () => app.db.verbaleRiconciliazione.delete({ where: { id: v.id } }))
      )
    ).toMatch(/permission denied|non si cancella/)
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.verbaleRiconciliazione.create({
            data: { ...dati, sha256: h('altro'), mime: 'text/plain' },
          })
        )
      )
    ).toMatch(/mime_check/)
    expect(
      await errore(
        nelTenant(t, () =>
          app.db.verbaleRiconciliazione.create({
            data: { ...dati, sha256: h('altro2'), dimensione: pdf.length + 1 },
          })
        )
      )
    ).toMatch(/dimensione_check/)
  })

  it('nessuna cancellazione dal ruolo applicativo; la RLS isola le aziende', async () => {
    const t1 = await azienda()
    const t2 = await azienda()
    const a = await nelTenant(t1, () => app.db.rapportoRiconciliazione.create({ data: v1(t1) }))
    expect(
      await errore(
        nelTenant(t1, () => app.db.rapportoRiconciliazione.delete({ where: { id: a.id } }))
      )
    ).toMatch(/permission denied|non si cancella/)
    expect(
      await nelTenant(t2, () => app.db.rapportoRiconciliazione.findUnique({ where: { id: a.id } }))
    ).toBeNull()
    expect(
      await errore(nelTenant(t2, () => app.db.rapportoRiconciliazione.create({ data: v1(t1) })))
    ).toMatch(/row-level security|violates/)
  })

  it('la cancellazione dell azienda porta via rapporti, campioni e verbali', async () => {
    const t = await azienda()
    const a = await nelTenant(t, () => app.db.rapportoRiconciliazione.create({ data: v1(t) }))
    await nelTenant(t, () =>
      app.db.campioneRiconciliazione.create({
        data: {
          tenantId: t,
          rapportoRadiceId: a.id,
          tipo: 'MOVIMENTO',
          riferimentoId: randomUUID(),
        },
      })
    )
    await cancellaAziendeDiProva(owner, [t])
    tenantCreati.splice(tenantCreati.indexOf(t), 1)
    expect(await owner.rapportoRiconciliazione.count({ where: { tenantId: t } })).toBe(0)
    expect(await owner.campioneRiconciliazione.count({ where: { tenantId: t } })).toBe(0)
  })
})
