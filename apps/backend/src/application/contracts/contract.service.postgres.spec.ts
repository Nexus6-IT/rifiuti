/**
 * Modifica, cancellazione logica e cambio di stato dei contratti (Fase 4 pezzo 0) contro un
 * Postgres reale, collegato COME `wasteflow_app`, dentro il `TenantContext`. Il proprietario
 * prepara i dati e legge lo stato finale. Pulizia solo per id esatti creati.
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

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { ContractService } from './contract.service'

describe('ContractService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: ContractService
  const tenantCreati: string[] = []
  let n = 0

  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new ContractService(app, logger as never)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
      await owner.activityLog.deleteMany({ where })
      await owner.contract.deleteMany({ where })
      await owner.produttore.deleteMany({ where })
      await owner.trasportatore.deleteMany({ where })
      await owner.destinatario.deleteMany({ where })
      await owner.sedeDitta.deleteMany({ where })
      await owner.ditta.deleteMany({ where })
      await owner.user.deleteMany({ where })
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
        ragioneSociale: 'Contratti servizio SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-contratti-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `contratti-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const produttore = await creaDittaConRuolo(owner, t.id, 'PRODUTTORE')
    const trasportatore = await creaDittaConRuolo(owner, t.id, 'TRASPORTATORE')
    return {
      tenantId: t.id,
      utenteId: utente.id,
      produttoreId: produttore.ruoloId,
      trasportatoreId: trasportatore.ruoloId,
    }
  }

  type Az = Awaited<ReturnType<typeof azienda>>
  const nuovo = (a: Az, numero: string) =>
    nel(a.tenantId, () =>
      service.create(a.tenantId, {
        contractNumber: numero,
        producerId: a.produttoreId,
        counterpartyId: a.trasportatoreId,
        counterpartyType: 'TRANSPORTER',
        contractType: 'WASTE_TRANSPORT',
        cerCodes: ['150101'],
        pricingModel: 'FLAT_RATE',
        basePrice: 100,
        startDate: new Date('2026-01-01T00:00:00Z'),
      })
    )
  const stato = (a: Az, id: string, s: 'PENDING_APPROVAL' | 'ACTIVE') =>
    nel(a.tenantId, () => service.changeStatus(a.tenantId, id, s))
  const codice = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e: any) {
      return { status: e.getStatus?.(), error: e.getResponse?.()?.error as string | undefined }
    }
    return null
  }

  it('modifica di una bozza: versione 2, campi aggiornati, updatedAt cambiato, un audit', async () => {
    const a = await azienda()
    const c = await nuovo(a, 'M-1')
    const vista = await nel(a.tenantId, () =>
      service.update(a.tenantId, a.utenteId, c.id, {
        versione: 1,
        basePrice: 250,
        description: 'X',
      })
    )
    expect(vista.versione).toBe(2)
    expect(Number(vista.basePrice)).toBe(250)
    expect(vista.description).toBe('X')
    expect(vista.updatedAt.getTime()).toBeGreaterThanOrEqual(c.updatedAt.getTime())
    const audit = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'CONTRATTO_MODIFICATO' },
    })
    expect(audit).toHaveLength(1)
  })

  it('due modifiche con la stessa versione: una riesce, l’altra 409', async () => {
    const a = await azienda()
    const c = await nuovo(a, 'M-2')
    const r = await Promise.allSettled([
      nel(a.tenantId, () =>
        service.update(a.tenantId, a.utenteId, c.id, { versione: 1, basePrice: 1 })
      ),
      nel(a.tenantId, () =>
        service.update(a.tenantId, a.utenteId, c.id, { versione: 1, basePrice: 2 })
      ),
    ])
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    const ko = r.find(x => x.status === 'rejected') as PromiseRejectedResult
    expect(ko.reason.getStatus()).toBe(409)
    expect((await owner.contract.findUniqueOrThrow({ where: { id: c.id } })).versione).toBe(2)
  })

  it('una modifica letta prima di un cambio di stato riceve 409', async () => {
    const a = await azienda()
    const c = await nuovo(a, 'M-3')
    const letta = await nel(a.tenantId, () => service.getById(a.tenantId, c.id))
    await stato(a, c.id, 'PENDING_APPROVAL')
    const e = await codice(
      nel(a.tenantId, () =>
        service.update(a.tenantId, a.utenteId, c.id, { versione: letta.versione, basePrice: 9 })
      )
    )
    expect(e?.status).toBe(409)
  })

  it('contratto attivo: prezzo e fine modificabili, produttore no (409)', async () => {
    const a = await azienda()
    const c = await nuovo(a, 'M-4')
    await stato(a, c.id, 'PENDING_APPROVAL')
    await stato(a, c.id, 'ACTIVE')
    const v = (await owner.contract.findUniqueOrThrow({ where: { id: c.id } })).versione
    const ok = await nel(a.tenantId, () =>
      service.update(a.tenantId, a.utenteId, c.id, {
        versione: v,
        basePrice: 300,
        endDate: new Date('2027-01-01T00:00:00Z'),
      })
    )
    expect(Number(ok.basePrice)).toBe(300)
    const altro = await creaDittaConRuolo(owner, a.tenantId, 'PRODUTTORE')
    const e = await codice(
      nel(a.tenantId, () =>
        service.update(a.tenantId, a.utenteId, c.id, {
          versione: ok.versione,
          producerId: altro.ruoloId,
        })
      )
    )
    expect(e).toEqual({ status: 409, error: 'CONTRATTO_NON_MODIFICABILE' })
  })

  it('numero già usato da un contratto eliminato: 409 CONTRATTO_NUMERO_DUPLICATO', async () => {
    const a = await azienda()
    const c = await nuovo(a, 'M-5')
    await nel(a.tenantId, () => service.elimina(a.tenantId, a.utenteId, c.id, 1))
    const e = await codice(nuovo(a, 'M-5'))
    expect(e).toEqual({ status: 409, error: 'CONTRATTO_NUMERO_DUPLICATO' })
  })

  it('eliminato: sparisce da list, 404 su getById/changeStatus/update/elimina, riga ancora nel database', async () => {
    const a = await azienda()
    const c = await nuovo(a, 'M-6')
    await nel(a.tenantId, () => service.elimina(a.tenantId, a.utenteId, c.id, 1))
    const lista = await nel(a.tenantId, () => service.list(a.tenantId))
    expect(lista.find(x => x.id === c.id)).toBeUndefined()
    expect((await codice(nel(a.tenantId, () => service.getById(a.tenantId, c.id))))?.status).toBe(
      404
    )
    expect((await stato(a, c.id, 'PENDING_APPROVAL').catch(e => e.getStatus())) as unknown).toBe(
      404
    )
    expect(
      (
        await codice(
          nel(a.tenantId, () => service.update(a.tenantId, a.utenteId, c.id, { versione: 2 }))
        )
      )?.status
    ).toBe(404)
    expect(
      (await codice(nel(a.tenantId, () => service.elimina(a.tenantId, a.utenteId, c.id, 2))))
        ?.status
    ).toBe(404)
    const riga = await owner.contract.findUniqueOrThrow({ where: { id: c.id } })
    expect(riga.eliminatoIl).not.toBeNull()
    expect(riga.eliminatoDa).toBe(a.utenteId)
  })

  it('contratto attivo non si elimina (409) e resta invariato', async () => {
    const a = await azienda()
    const c = await nuovo(a, 'M-7')
    await stato(a, c.id, 'PENDING_APPROVAL')
    await stato(a, c.id, 'ACTIVE')
    const prima = await owner.contract.findUniqueOrThrow({ where: { id: c.id } })
    const e = await codice(
      nel(a.tenantId, () => service.elimina(a.tenantId, a.utenteId, c.id, prima.versione))
    )
    expect(e).toEqual({ status: 409, error: 'CONTRATTO_NON_ELIMINABILE' })
    const dopo = await owner.contract.findUniqueOrThrow({ where: { id: c.id } })
    expect(dopo.eliminatoIl).toBeNull()
    expect(dopo.versione).toBe(prima.versione)
  })

  it('nel contesto di B la modifica e la cancellazione di un contratto di A danno 404', async () => {
    const a = await azienda()
    const b = await azienda()
    const c = await nuovo(a, 'M-8')
    const m = await codice(
      nel(b.tenantId, () =>
        service.update(b.tenantId, b.utenteId, c.id, { versione: 1, basePrice: 5 })
      )
    )
    const d = await codice(nel(b.tenantId, () => service.elimina(b.tenantId, b.utenteId, c.id, 1)))
    expect(m?.status).toBe(404)
    expect(d?.status).toBe(404)
    expect((await owner.contract.findUniqueOrThrow({ where: { id: c.id } })).versione).toBe(1)
  })
})
