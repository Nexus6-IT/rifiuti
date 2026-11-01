/**
 * Spese accessorie (4.1a) contro un Postgres reale, collegato COME `wasteflow_app`, dentro
 * il `TenantContext`. Il proprietario prepara le aziende e legge lo stato finale. Pulizia solo per
 * id esatti creati (FK a cascata su `tenants`).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
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
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { SpeseAccessorieService } from './spese-accessorie.service'

describe('SpeseAccessorieService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: SpeseAccessorieService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new SpeseAccessorieService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.user.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now() + n),
        ragioneSociale: 'Spese accessorie SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-spese-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `spese-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  const dati = {
    tipo: 'INCASSO' as const,
    codice: 'INC',
    descrizione: 'Spese di incasso',
    importo: '2.50',
  }

  it('spesa: crea, modifica, disattiva, elimina', async () => {
    const { tenantId, utenteId } = await azienda()
    const creata = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    expect(creata).toMatchObject({
      tipo: 'INCASSO',
      importo: '2.50',
      attiva: true,
      versione: 1,
      eliminabile: true,
    })
    const modificata = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creata.id, { importo: '3.75', versione: 1 })
    )
    expect(modificata).toMatchObject({ importo: '3.75', versione: 2 })
    const disattivata = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creata.id, { attiva: false, versione: 2 })
    )
    expect(disattivata).toMatchObject({ attiva: false, versione: 3 })
    expect(
      await nel(tenantId, () => service.list(tenantId, { incluseDisattivate: false }))
    ).toHaveLength(0)
    expect(
      await nel(tenantId, () => service.list(tenantId, { incluseDisattivate: true }))
    ).toHaveLength(1)
    await nel(tenantId, () => service.elimina(tenantId, utenteId, creata.id, 3))
    expect(await owner.spesaAccessoria.count({ where: { id: creata.id } })).toBe(0)
  })

  it('importo "4,5" salvato 4.50 nel database', async () => {
    const { tenantId, utenteId } = await azienda()
    const s = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { ...dati, importo: '4,5' })
    )
    expect(s.importo).toBe('4.50')
    const riga = await owner.spesaAccessoria.findUnique({ where: { id: s.id } })
    expect(riga?.importo.toFixed(2)).toBe('4.50')
  })

  it('l’elenco filtra per tipo', async () => {
    const { tenantId, utenteId } = await azienda()
    await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { ...dati, tipo: 'BOLLO', codice: 'BOL', importo: '2' })
    )
    const bolli = await nel(tenantId, () =>
      service.list(tenantId, { tipo: 'BOLLO', incluseDisattivate: false })
    )
    expect(bolli.map(s => s.codice)).toEqual(['BOL'])
    expect(
      await nel(tenantId, () => service.list(tenantId, { incluseDisattivate: false }))
    ).toHaveLength(2)
  })

  it('codice duplicato nello stesso tipo: 409; stesso codice in un altro tipo o azienda va bene', async () => {
    const a = await azienda()
    const b = await azienda()
    await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    await expect(
      nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'SPESA_ACCESSORIA_CODICE_DUPLICATO' },
    })
    await expect(
      nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, { ...dati, tipo: 'BOLLO' }))
    ).resolves.toMatchObject({ tipo: 'BOLLO' })
    await expect(
      nel(b.tenantId, () => service.crea(b.tenantId, b.utenteId, dati))
    ).resolves.toMatchObject({ codice: 'INC' })
  })

  it('cambio di tipo che collide con un codice dello stesso tipo: 409', async () => {
    const { tenantId, utenteId } = await azienda()
    await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    const bollo = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { ...dati, tipo: 'BOLLO' })
    )
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, bollo.id, { tipo: 'INCASSO', versione: 1 })
      )
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'SPESA_ACCESSORIA_CODICE_DUPLICATO' },
    })
  })

  it('due modifiche concorrenti sulla stessa versione: una passa, l’altra 409', async () => {
    const { tenantId, utenteId } = await azienda()
    const s = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    const r = await Promise.allSettled([
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, s.id, { importo: '1', versione: 1 })
      ),
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, s.id, { importo: '2', versione: 1 })
      ),
    ])
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    expect(
      ((r.find(x => x.status === 'rejected') as PromiseRejectedResult).reason as any).status
    ).toBe(409)
  })

  it('audit: solo id, tipo, codice e nomi dei campi', async () => {
    const { tenantId, utenteId } = await azienda()
    const s = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, s.id, { importo: '9.99', versione: 1 })
    )
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'SPESA_ACCESSORIA_' } },
    })
    expect(audit.map(a => a.action).sort()).toEqual([
      'SPESA_ACCESSORIA_CREATA',
      'SPESA_ACCESSORIA_MODIFICATA',
    ])
    const json = JSON.stringify(audit.map(a => a.metadata))
    expect(json).not.toContain('9.99')
    expect(json).not.toContain('Spese di incasso')
  })

  it('nel contesto di B la spesa di A è 404 (lettura, modifica, eliminazione)', async () => {
    const a = await azienda()
    const b = await azienda()
    const s = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    await expect(nel(b.tenantId, () => service.getById(b.tenantId, s.id))).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      nel(b.tenantId, () =>
        service.modifica(b.tenantId, b.utenteId, s.id, { attiva: false, versione: 1 })
      )
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      nel(b.tenantId, () => service.elimina(b.tenantId, b.utenteId, s.id, 1))
    ).rejects.toMatchObject({ status: 404 })
    expect(
      await nel(b.tenantId, () => service.list(b.tenantId, { incluseDisattivate: true }))
    ).toHaveLength(0)
    expect((await owner.spesaAccessoria.findUnique({ where: { id: s.id } }))?.versione).toBe(1)
  })
})
