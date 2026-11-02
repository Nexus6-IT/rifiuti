/**
 * Codici IVA (4.2a) contro un Postgres reale, collegato COME `wasteflow_app`, dentro il
 * `TenantContext`. Il proprietario prepara le aziende e legge lo stato finale. Pulizia solo per
 * id esatti creati.
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
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
} from '../../test-support/listino-di-test'

import { CodiciIvaService } from './codici-iva.service'

describe('CodiciIvaService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: CodiciIvaService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new CodiciIvaService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      // Righe ed elenchi vanno a cascata col contratto; le FK NoAction verso addebiti, codifiche e
      // codici IVA chiedono di cancellare prima i contratti.
      await owner.contrattoCliente.updateMany({
        where: { tenantId: in_ },
        data: { contrattoPrincipaleId: null },
      })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.cliente.deleteMany({ where: { tenantId: in_ } })
      await owner.addebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codificaAddebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codiceIva.deleteMany({ where: { tenantId: in_ } })
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
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Codici IVA SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-codici-iva-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `codici-iva-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  const dati = { codice: '10', descrizione: 'IVA ridotta 10%', aliquota: '10' }

  it('la fixture crea due codici IVA e una codifica per genere', async () => {
    const { tenantId } = await azienda()
    const ids = await creaCodiciIvaEcodifiche(owner, tenantId)
    expect(await owner.codiceIva.count({ where: { tenantId } })).toBe(2)
    expect(await owner.codificaAddebito.count({ where: { tenantId } })).toBe(5)
    expect(new Set(Object.values(ids)).size).toBe(Object.keys(ids).length)
  })

  it('crea (attivo di default), modifica, disattiva: versione 3, audit di modifica, aliquota a due decimali', async () => {
    const { tenantId, utenteId } = await azienda()
    const creato = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    expect(creato).toMatchObject({
      codice: '10',
      aliquota: '10.00',
      natura: null,
      attivo: true,
      versione: 1,
      eliminabile: true,
    })

    const modificato = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creato.id, { aliquota: '4,5', versione: 1 })
    )
    expect(modificato).toMatchObject({ versione: 2, aliquota: '4.50' })

    const disattivato = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creato.id, { attivo: false, versione: 2 })
    )
    expect(disattivato).toMatchObject({ versione: 3, attivo: false })

    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'CODICE_IVA_' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map(a => a.action)).toEqual([
      'CODICE_IVA_CREATO',
      'CODICE_IVA_MODIFICATO',
      'CODICE_IVA_MODIFICATO',
    ])
    expect((audit[1].metadata as any).campi).toEqual(['aliquota'])
    expect((audit[2].metadata as any).campi).toEqual(['attivo'])
    expect(audit.every(a => a.userId === utenteId)).toBe(true)

    expect(await nel(tenantId, () => service.list(tenantId, false))).toHaveLength(0)
    expect(await nel(tenantId, () => service.list(tenantId, true))).toHaveLength(1)
  })

  it('aliquota zero richiede la natura; con natura si salva e si può togliere solo alzando l’aliquota', async () => {
    const { tenantId, utenteId } = await azienda()
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, { codice: 'N4', descrizione: 'Esente', aliquota: '0' })
      )
    ).rejects.toMatchObject({ status: 400, response: { error: 'CODICE_IVA_NON_VALIDO' } })
    const v = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, {
        codice: 'N4',
        descrizione: 'Esente',
        aliquota: '0',
        natura: 'N4',
      })
    )
    expect(v).toMatchObject({ aliquota: '0.00', natura: 'N4' })
    await expect(
      nel(tenantId, () => service.modifica(tenantId, utenteId, v.id, { natura: null, versione: 1 }))
    ).rejects.toMatchObject({ status: 400 })
    const w = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, v.id, { aliquota: '22', natura: null, versione: 1 })
    )
    expect(w).toMatchObject({ aliquota: '22.00', natura: null, versione: 2 })
  })

  it('due modifiche concorrenti sulla stessa versione: una passa, l’altra 409', async () => {
    const { tenantId, utenteId } = await azienda()
    const creato = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    const tentativo = (descrizione: string) =>
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, creato.id, { descrizione, versione: 1 })
      )
    const esiti = await Promise.allSettled([tentativo('Prima'), tentativo('Seconda')])
    const falliti = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    expect(falliti).toHaveLength(1)
    expect(falliti[0].reason.getStatus()).toBe(409)
    expect(falliti[0].reason.getResponse().error).toBe('CODICE_IVA_MODIFICATO_NEL_FRATTEMPO')
    expect((await owner.codiceIva.findUnique({ where: { id: creato.id } }))?.versione).toBe(2)
  })

  it('codice duplicato nell’azienda: 409 col codice del vincolo; in un’altra azienda va bene', async () => {
    const a = await azienda()
    const b = await azienda()
    await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    await expect(
      nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    ).rejects.toMatchObject({
      response: { error: 'CODICE_IVA_CODICE_DUPLICATO' },
      status: 409,
    })
    await expect(
      nel(b.tenantId, () => service.crea(b.tenantId, b.utenteId, dati))
    ).resolves.toMatchObject({ codice: '10' })
  })

  it('elimina con versione giusta cancella; con versione vecchia 409 e la riga resta', async () => {
    const { tenantId, utenteId } = await azienda()
    const creato = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, creato.id, 7))
    ).rejects.toMatchObject({ status: 409 })
    expect(await owner.codiceIva.count({ where: { id: creato.id } })).toBe(1)
    await nel(tenantId, () => service.elimina(tenantId, utenteId, creato.id, 1))
    expect(await owner.codiceIva.count({ where: { id: creato.id } })).toBe(0)
    expect(
      await owner.activityLog.count({ where: { tenantId, action: 'CODICE_IVA_ELIMINATO' } })
    ).toBe(1)
  })

  it('nel contesto di B il codice IVA di A è 404 (lettura, modifica, eliminazione)', async () => {
    const a = await azienda()
    const b = await azienda()
    const creato = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    await expect(
      nel(b.tenantId, () => service.getById(b.tenantId, creato.id))
    ).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      nel(b.tenantId, () =>
        service.modifica(b.tenantId, b.utenteId, creato.id, { attivo: false, versione: 1 })
      )
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      nel(b.tenantId, () => service.elimina(b.tenantId, b.utenteId, creato.id, 1))
    ).rejects.toMatchObject({ status: 404 })
    expect(await nel(b.tenantId, () => service.list(b.tenantId, true))).toHaveLength(0)
  })

  it('in uso da un addebito: eliminabile false, elimina 409 col testo intero, la riga resta', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaCodiciIvaEcodifiche(owner, tenantId)
    await owner.addebito.create({
      data: {
        tenantId,
        codice: '00001',
        descrizione: 'Addebito di prova',
        gruppoId: ids.gruppoId,
        unitaMisura: 'NR',
        codiceIvaId: ids.iva22Id,
      },
    })
    const v = await nel(tenantId, () => service.getById(tenantId, ids.iva22Id))
    expect(v.eliminabile).toBe(false)
    const elenco = await nel(tenantId, () => service.list(tenantId, true))
    expect(elenco.find(x => x.id === ids.iva22Id)?.eliminabile).toBe(false)
    expect(elenco.find(x => x.id === ids.ivaN61Id)?.eliminabile).toBe(true)
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, ids.iva22Id, 1))
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'CODICE_IVA_IN_USO',
        message:
          "Il codice IVA è usato da addebiti dell'archivio o da righe dei listini: disattivalo invece di eliminarlo.",
      },
    })
    expect(await owner.codiceIva.count({ where: { id: ids.iva22Id } })).toBe(1)
    // disattivare un codice in uso si può
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, ids.iva22Id, { attivo: false, versione: 1 })
      )
    ).resolves.toMatchObject({ attivo: false })
  })

  it('in uso da una riga di un listino (R44): eliminabile false, elimina 409 col testo intero, la riga resta', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaCodiciIvaEcodifiche(owner, tenantId)
    const c = await creaContrattoConElenco(owner, tenantId)
    await creaRiga(owner, tenantId, c.elencoId, { codiceIvaId: ids.iva22Id })
    expect(await owner.addebito.count({ where: { tenantId, codiceIvaId: ids.iva22Id } })).toBe(0)
    const elenco = await nel(tenantId, () => service.list(tenantId, true))
    expect(elenco.find(x => x.id === ids.iva22Id)?.eliminabile).toBe(false)
    expect(elenco.find(x => x.id === ids.ivaN61Id)?.eliminabile).toBe(true)
    expect((await nel(tenantId, () => service.getById(tenantId, ids.iva22Id))).eliminabile).toBe(
      false
    )
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, ids.iva22Id, 1))
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'CODICE_IVA_IN_USO',
        message:
          "Il codice IVA è usato da addebiti dell'archivio o da righe dei listini: disattivalo invece di eliminarlo.",
      },
    })
    expect(await owner.codiceIva.count({ where: { id: ids.iva22Id } })).toBe(1)
  })
})
