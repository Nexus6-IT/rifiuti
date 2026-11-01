/**
 * Agenti (4.1b) contro un Postgres reale, collegato COME `wasteflow_app`, dentro il
 * `TenantContext`. Il proprietario prepara le aziende e legge lo stato finale. Pulizia solo per id
 * esatti creati (FK a cascata su `tenants`).
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
import { DittaPrismaRepository } from '../../infrastructure/persistence/ditta-prisma.repository'
import { creaDittaConRuolo, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { DitteService } from '../registry/ditte/ditte.service'
import { AgentiService } from './agenti.service'

describe('AgentiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let ditte: DitteService
  let service: AgentiService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    ditte = new DitteService(app, new DittaPrismaRepository())
    service = new AgentiService(app, ditte)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      // Le FK composite fra agenti/clienti e ditte sono NoAction: prima i ruoli, poi le ditte.
      const in_ = { in: tenantCreati }
      await owner.cliente.deleteMany({ where: { tenantId: in_ } })
      await owner.agente.deleteMany({ where: { tenantId: in_ } })
      await owner.activityLog.deleteMany({ where: { tenantId: in_ } })
      await owner.user.deleteMany({ where: { tenantId: in_ } })
      await owner.tenant.deleteMany({ where: { id: in_ } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now() + n),
        ragioneSociale: 'Agenti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-agenti-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `agenti-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  const indirizzo = { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' }
  const nuovo = (extra: Record<string, unknown> = {}) => ({
    ragioneSociale: `Agenzia ${++n}`,
    partitaIva: partitaIvaValida(Date.now() + ++n),
    indirizzo,
    ...extra,
  })

  it('crea, legge, modifica, disattiva ed elimina un agente', async () => {
    const { tenantId, utenteId } = await azienda()
    const dati = nuovo({ codice: 'AG1', note: 'Zona nord' })
    const r = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    expect(r).toMatchObject({
      dittaEsistente: false,
      avvisi: [],
      agente: {
        codice: 'AG1',
        note: 'Zona nord',
        attivo: true,
        versione: 1,
        clienti: 0,
        contratti: 0,
        eliminabile: true,
        ditta: { ragioneSociale: dati.ragioneSociale, partitaIva: dati.partitaIva },
        sede: { citta: 'Roma', principale: true, attiva: true },
      },
    })
    const id = r.agente.id

    const mod = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, id, { note: null, codice: 'AG2', versione: 1 })
    )
    expect(mod).toMatchObject({ note: null, codice: 'AG2', versione: 2 })
    const off = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, id, { attivo: false, versione: 2 })
    )
    expect(off).toMatchObject({ attivo: false, versione: 3 })
    const azioni = (
      await owner.activityLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })
    ).map(a => a.action)
    expect(azioni).toEqual(['AGENTE_CREATO', 'AGENTE_MODIFICATO', 'AGENTE_DISATTIVATO'])

    await nel(tenantId, () => service.elimina(tenantId, utenteId, id, 3))
    expect(await owner.agente.count({ where: { id } })).toBe(0)
    // la ditta e la sede restano (sono di F2-10)
    expect(await owner.ditta.count({ where: { id: r.agente.ditta.id } })).toBe(1)
  })

  it('agente su una ditta già produttore: stessa ditta, ruoli con produttoreId e agenteId', async () => {
    const { tenantId, utenteId } = await azienda()
    const piva = partitaIvaValida(Date.now() + ++n)
    const prod = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
      partitaIva: piva,
      ragioneSociale: 'Ditta mista',
    })
    const r = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, nuovo({ partitaIva: piva, ragioneSociale: 'Ditta mista' }))
    )
    expect(r.dittaEsistente).toBe(true)
    expect(r.agente.ditta.id).toBe(prod.dittaId)
    const dto = await nel(tenantId, () => ditte.dettaglio(prod.dittaId))
    expect(dto.ruoli).toEqual({ produttoreId: prod.ruoloId, agenteId: r.agente.id })
    const audit = await owner.activityLog.findFirst({
      where: { tenantId, action: 'AGENTE_CREATO' },
    })
    expect(audit?.metadata).toEqual({
      agenteId: r.agente.id,
      dittaId: prod.dittaId,
      dittaEsistente: true,
    })
  })

  it('un privato senza partita IVA non è ammesso come agente (400)', async () => {
    const { tenantId, utenteId } = await azienda()
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, {
          ragioneSociale: 'Mario Rossi',
          partitaIva: null,
          codiceFiscale: 'RSSMRA80A01H501U',
          indirizzo,
        })
      )
    ).rejects.toMatchObject({
      message: 'Un privato senza partita IVA può essere solo produttore o cliente.',
    })
    expect(await owner.agente.count({ where: { tenantId } })).toBe(0)
  })

  it('stesso agente due volte: 400 "Esiste già un agente per questa ditta"', async () => {
    const { tenantId, utenteId } = await azienda()
    const dati = nuovo()
    await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    await expect(nel(tenantId, () => service.crea(tenantId, utenteId, dati))).rejects.toMatchObject(
      { status: 400, response: { message: 'Esiste già un agente per questa ditta' } }
    )
  })

  it('due crea concorrenti sulla stessa ditta: una riesce, l’altra 400 col messaggio del ruolo presente', async () => {
    const { tenantId, utenteId } = await azienda()
    const dati = nuovo()
    const r = await Promise.allSettled([
      nel(tenantId, () => service.crea(tenantId, utenteId, dati)),
      nel(tenantId, () => service.crea(tenantId, utenteId, dati)),
    ])
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    const rifiutata = r.find(x => x.status === 'rejected') as PromiseRejectedResult
    expect(rifiutata.reason).toMatchObject({
      status: 400,
      response: { message: 'Esiste già un agente per questa ditta' },
    })
    expect(await owner.agente.count({ where: { tenantId } })).toBe(1)
  })

  it('due crea concorrenti con lo stesso codice su ditte diverse: una riesce, l’altra 409 del codice', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await Promise.allSettled([
      nel(tenantId, () => service.crea(tenantId, utenteId, nuovo({ codice: 'DUP' }))),
      nel(tenantId, () => service.crea(tenantId, utenteId, nuovo({ codice: 'DUP' }))),
    ])
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    const rifiutata = r.find(x => x.status === 'rejected') as PromiseRejectedResult
    expect(rifiutata.reason).toMatchObject({
      status: 409,
      response: { error: 'AGENTE_CODICE_DUPLICATO' },
    })
  })

  it('codice duplicato in modifica: 409; in un’altra azienda lo stesso codice va bene', async () => {
    const a = await azienda()
    const b = await azienda()
    await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, nuovo({ codice: 'X1' })))
    const secondo = await nel(a.tenantId, () =>
      service.crea(a.tenantId, a.utenteId, nuovo({ codice: 'X2' }))
    )
    await expect(
      nel(a.tenantId, () =>
        service.modifica(a.tenantId, a.utenteId, secondo.agente.id, { codice: 'X1', versione: 1 })
      )
    ).rejects.toMatchObject({ status: 409, response: { error: 'AGENTE_CODICE_DUPLICATO' } })
    await expect(
      nel(b.tenantId, () => service.crea(b.tenantId, b.utenteId, nuovo({ codice: 'X1' })))
    ).resolves.toMatchObject({ agente: { codice: 'X1' } })
  })

  it('ricerca e paginazione', async () => {
    const { tenantId, utenteId } = await azienda()
    for (const [nome, codice] of [
      ['Alfa Agenzia', 'A1'],
      ['Beta Agenzia', 'B1'],
      ['Gamma Rappresentanze', 'G1'],
    ]) {
      await nel(tenantId, () =>
        service.crea(tenantId, utenteId, nuovo({ ragioneSociale: nome, codice }))
      )
    }
    const tutti = await nel(tenantId, () => service.list(tenantId, { pagina: 1, dimensione: 25 }))
    expect(tutti.totale).toBe(3)
    expect(tutti.elementi.map(e => e.ditta.ragioneSociale)).toEqual([
      'Alfa Agenzia',
      'Beta Agenzia',
      'Gamma Rappresentanze',
    ])
    const p2 = await nel(tenantId, () => service.list(tenantId, { pagina: 2, dimensione: 2 }))
    expect(p2.totale).toBe(3)
    expect(p2.elementi.map(e => e.ditta.ragioneSociale)).toEqual(['Gamma Rappresentanze'])
    const perNome = await nel(tenantId, () =>
      service.list(tenantId, { testo: 'agenzia', pagina: 1, dimensione: 25 })
    )
    expect(perNome.totale).toBe(2)
    const perCodice = await nel(tenantId, () =>
      service.list(tenantId, { testo: 'g1', pagina: 1, dimensione: 25 })
    )
    expect(perCodice.elementi.map(e => e.codice)).toEqual(['G1'])
    const piva = tutti.elementi[1].ditta.partitaIva as string
    const perPiva = await nel(tenantId, () =>
      service.list(tenantId, { testo: piva, pagina: 1, dimensione: 25 })
    )
    expect(perPiva.elementi.map(e => e.ditta.ragioneSociale)).toEqual(['Beta Agenzia'])
    const id = tutti.elementi[0].id
    await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, id, { attivo: false, versione: 1 })
    )
    const attivi = await nel(tenantId, () =>
      service.list(tenantId, { soloAttivi: true, pagina: 1, dimensione: 25 })
    )
    expect(attivi.totale).toBe(2)
  })

  it('nel contesto di B: lista vuota, getById 404 (isolamento fra aziende)', async () => {
    const a = await azienda()
    const b = await azienda()
    const r = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, nuovo()))
    const lista = await nel(b.tenantId, () =>
      service.list(b.tenantId, { pagina: 1, dimensione: 25 })
    )
    expect(lista).toEqual({ elementi: [], totale: 0 })
    await expect(
      nel(b.tenantId, () => service.getById(b.tenantId, r.agente.id))
    ).rejects.toMatchObject({ status: 404, response: { error: 'AGENTE_NON_TROVATO' } })
    await expect(
      nel(b.tenantId, () => service.modifica(b.tenantId, b.utenteId, r.agente.id, { versione: 1 }))
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      nel(b.tenantId, () => service.elimina(b.tenantId, b.utenteId, r.agente.id, 1))
    ).rejects.toMatchObject({ status: 404 })
  })

  it('la sede predefinita dell’agente non si disattiva (via DitteService.aggiornaSede)', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await nel(tenantId, () => service.crea(tenantId, utenteId, nuovo()))
    const dittaId = r.agente.ditta.id
    const seconda = await nel(tenantId, () =>
      ditte.aggiungiSede(dittaId, {
        indirizzo: {
          via: 'Via Milano',
          civico: '2',
          cap: '20100',
          citta: 'Milano',
          provincia: 'MI',
        },
      })
    )
    const cambiata = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, r.agente.id, { sedeId: seconda.id, versione: 1 })
    )
    expect(cambiata.sede.id).toBe(seconda.id)
    await expect(
      nel(tenantId, () => ditte.aggiornaSede(dittaId, seconda.id, { attiva: false }))
    ).rejects.toMatchObject({ message: expect.stringContaining("dell'agente") })
    // una sede disattivata non si sceglie come predefinita
    const altra = await nel(tenantId, () =>
      ditte.aggiungiSede(dittaId, {
        indirizzo: {
          via: 'Via Napoli',
          civico: '3',
          cap: '80100',
          citta: 'Napoli',
          provincia: 'NA',
        },
      })
    )
    await nel(tenantId, () => ditte.aggiornaSede(dittaId, altra.id, { attiva: false }))
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, r.agente.id, { sedeId: altra.id, versione: 2 })
      )
    ).rejects.toMatchObject({
      message: "La sede indicata non è una sede attiva dell'agente scelto",
    })
  })

  it('elimina un agente citato da un cliente: 409 AGENTE_IN_USO, la riga resta, eliminabile false', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await nel(tenantId, () => service.crea(tenantId, utenteId, nuovo()))
    const prod = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE')
    await owner.cliente.create({
      data: { tenantId, dittaId: prod.dittaId, sedeId: prod.sedeId, agenteId: r.agente.id },
    })
    const v = await nel(tenantId, () => service.getById(tenantId, r.agente.id))
    expect(v).toMatchObject({ clienti: 1, contratti: 0, eliminabile: false })
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, r.agente.id, 1))
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'AGENTE_IN_USO',
        message: "L'agente è indicato su clienti o contratti: disattivalo invece di eliminarlo.",
      },
    })
    expect(await owner.agente.count({ where: { id: r.agente.id } })).toBe(1)
  })

  it('agente citato solo da un contratto eliminato: contratti 0, non eliminabile, elimina 409 (R25)', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await nel(tenantId, () => service.crea(tenantId, utenteId, nuovo()))
    const prod = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE')
    const cliente = await owner.cliente.create({
      data: { tenantId, dittaId: prod.dittaId, sedeId: prod.sedeId },
    })
    await owner.contrattoCliente.create({
      data: {
        tenantId,
        clienteId: cliente.id,
        numero: 'CC-2026-001',
        descrizione: 'Bozza eliminata',
        dataInizio: new Date('2026-01-01'),
        agenteId: r.agente.id,
        eliminatoIl: new Date(),
      },
    })
    const v = await nel(tenantId, () => service.getById(tenantId, r.agente.id))
    expect(v).toMatchObject({ clienti: 0, contratti: 0, eliminabile: false })
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, r.agente.id, 1))
    ).rejects.toMatchObject({ status: 409, response: { error: 'AGENTE_IN_USO' } })
    await owner.contrattoCliente.deleteMany({ where: { tenantId } })
  })

  it('attiviPerId: stato degli agenti dell’azienda, nessuno di un’altra', async () => {
    const a = await azienda()
    const b = await azienda()
    const r = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, nuovo()))
    await nel(a.tenantId, () =>
      service.modifica(a.tenantId, a.utenteId, r.agente.id, { attivo: false, versione: 1 })
    )
    const daA = await nel(a.tenantId, () =>
      app.$transaction(tx => service.attiviPerId(tx, [r.agente.id]))
    )
    expect(daA.get(r.agente.id)).toEqual({ id: r.agente.id, attivo: false })
    const daB = await nel(b.tenantId, () =>
      app.$transaction(tx => service.attiviPerId(tx, [r.agente.id]))
    )
    expect(daB.size).toBe(0)
  })
})
