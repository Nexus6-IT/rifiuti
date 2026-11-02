/**
 * Spese accessorie (4.1a) contro un Postgres reale, collegato COME `wasteflow_app`, dentro
 * il `TenantContext`. Il proprietario prepara le aziende e legge lo stato finale. Pulizia solo per
 * id esatti creati (FK a cascata su `tenants`).
 */
import { Prisma, PrismaClient } from '@prisma/client'
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
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaTabelleFatturazione } from '../../test-support/fatturazione-di-test'
import { SpeseAccessorieService } from './spese-accessorie.service'

describe('SpeseAccessorieService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: SpeseAccessorieService
  const tenantCreati: string[] = []
  let n = 0
  let contratti = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new SpeseAccessorieService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      await owner.allegatoContrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.periodoFatturazioneCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.cliente.deleteMany({ where: { tenantId: in_ } })
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
        partitaIva: partitaIvaUnica(),
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

  /** Cliente (ditta con ruolo CLIENTE, col proprietario) che cita le righe indicate. */
  async function clienteConRiferimento(
    tenantId: string,
    campo: Partial<Prisma.ClienteUncheckedCreateInput>
  ) {
    const c = await creaDittaConRuolo(owner, tenantId, 'CLIENTE')
    // `creaDittaConRuolo(…, 'CLIENTE')` crea gia' la riga del cliente: la si aggiorna.
    return owner.cliente.update({ where: { id: c.ruoloId }, data: campo })
  }

  /** Contratto (su un cliente nuovo) che cita le righe indicate. */
  async function contrattoConRiferimento(
    tenantId: string,
    campo: Partial<Prisma.ContrattoClienteUncheckedCreateInput>
  ) {
    const cliente = await clienteConRiferimento(tenantId, {})
    return owner.contrattoCliente.create({
      data: {
        tenantId,
        clienteId: cliente.id,
        numero: `CC-2026-${++contratti}`,
        descrizione: 'Contratto di prova',
        dataInizio: new Date('2026-01-01'),
        ...campo,
      },
    })
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

  it('in uso da un cliente: elimina 409, la riga resta, eliminabile false', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await clienteConRiferimento(tenantId, { speseIncassoId: ids.speseId })
    const v = await nel(tenantId, () => service.getById(tenantId, ids.speseId))
    expect(v.eliminabile).toBe(false)
    const elenco = await nel(tenantId, () => service.list(tenantId, { incluseDisattivate: true }))
    expect(elenco.find(x => x.id === ids.speseId)?.eliminabile).toBe(false)
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, ids.speseId, 1))
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'SPESA_ACCESSORIA_IN_USO',
        message:
          'La spesa accessoria è usata da clienti o contratti: disattivala invece di eliminarla.',
      },
    })
    expect(await owner.spesaAccessoria.count({ where: { id: ids.speseId } })).toBe(1)
  })

  it('bollo in uso da un contratto: elimina 409, la riga resta, eliminabile false', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await contrattoConRiferimento(tenantId, { bolloId: ids.bolloId })
    const v = await nel(tenantId, () => service.getById(tenantId, ids.bolloId))
    expect(v.eliminabile).toBe(false)
    const elenco = await nel(tenantId, () => service.list(tenantId, { incluseDisattivate: true }))
    expect(elenco.find(x => x.id === ids.bolloId)?.eliminabile).toBe(false)
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, ids.bolloId, 1))
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'SPESA_ACCESSORIA_IN_USO',
        message:
          'La spesa accessoria è usata da clienti o contratti: disattivala invece di eliminarla.',
      },
    })
    expect(await owner.spesaAccessoria.count({ where: { id: ids.bolloId } })).toBe(1)
  })

  it('cambio di tipo della spesa usata: 409 SPESA_ACCESSORIA_IN_USO e il tipo resta; altre modifiche ammesse', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await clienteConRiferimento(tenantId, { speseIncassoId: ids.speseId })
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, ids.speseId, { tipo: 'BOLLO', versione: 1 })
      )
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'SPESA_ACCESSORIA_IN_USO',
        message: 'La spesa è usata da clienti o contratti: non se ne cambia il tipo.',
      },
    })
    expect((await owner.spesaAccessoria.findUnique({ where: { id: ids.speseId } }))?.tipo).toBe(
      'INCASSO'
    )
    const ok = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, ids.speseId, { descrizione: 'Nuova', versione: 1 })
    )
    expect(ok.descrizione).toBe('Nuova')
  })

  it('cambio di tipo della spesa mentre un cliente la sceglie come bollo: una delle due fallisce (R24)', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    const c = await creaDittaConRuolo(owner, tenantId, 'CLIENTE')
    const stato = { bloccata: false }
    let rilascia!: () => void
    const attesa = new Promise<void>(r => (rilascia = r))
    // Il cliente legge la spesa FOR SHARE (come controllaRiferimenti) e scrive piu' tardi.
    const sceglie = nel(tenantId, () =>
      app.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "spese_accessorie" WHERE id = ${ids.bolloId}::uuid FOR SHARE`
        stato.bloccata = true
        await attesa
        await tx.cliente.update({ where: { id: c.ruoloId }, data: { bolloId: ids.bolloId } })
      })
    )
    while (!stato.bloccata) await new Promise(r => setTimeout(r, 20))
    const esito = nel(tenantId, () =>
      service.modifica(tenantId, utenteId, ids.bolloId, {
        tipo: 'INCASSO',
        codice: 'ALTRO',
        versione: 1,
      })
    ).then(
      () => 'riuscita' as const,
      (e: unknown) => e
    )
    const intanto = await Promise.race([
      esito,
      new Promise(r => setTimeout(() => r('in attesa'), 600)),
    ])
    expect(intanto).toBe('in attesa')
    rilascia()
    await sceglie
    expect(await esito).toMatchObject({
      status: 409,
      response: { error: 'SPESA_ACCESSORIA_IN_USO' },
    })
    expect((await owner.spesaAccessoria.findUnique({ where: { id: ids.bolloId } }))?.tipo).toBe(
      'BOLLO'
    )
    expect(await owner.cliente.count({ where: { tenantId, bolloId: ids.bolloId } })).toBe(1)
  })

  it('citata solo da un contratto eliminato: eliminabile false, la FK lo vede (R23)', async () => {
    const { tenantId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await contrattoConRiferimento(tenantId, {
      speseIncassoId: ids.speseId,
      eliminatoIl: new Date(),
    })
    const v = await nel(tenantId, () => service.getById(tenantId, ids.speseId))
    expect(v.eliminabile).toBe(false)
  })
})
