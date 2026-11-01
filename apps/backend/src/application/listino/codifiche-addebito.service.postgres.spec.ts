/**
 * Codifiche di addebito (4.2a) contro un Postgres reale, collegato COME `wasteflow_app`, dentro
 * il `TenantContext`. Il proprietario prepara le aziende e legge lo stato finale. Pulizia solo
 * per id esatti creati.
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
import { creaCodiciIvaEcodifiche } from '../../test-support/listino-di-test'

import { CodificheAddebitoService } from './codifiche-addebito.service'

describe('CodificheAddebitoService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: CodificheAddebitoService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new CodificheAddebitoService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
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
        partitaIva: partitaIvaValida(Date.now() + n),
        ragioneSociale: 'Codifiche addebito SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-codifiche-addebito-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `codifiche-addebito-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  it('crea con codice normale (7 -> 007), modifica, disattiva: versione 3 e audit', async () => {
    const { tenantId, utenteId } = await azienda()
    const creata = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { genere: 'GRUPPO', codice: '7', descrizione: 'Raccolta' })
    )
    expect(creata).toMatchObject({
      genere: 'GRUPPO',
      codice: '007',
      attiva: true,
      versione: 1,
      eliminabile: true,
    })
    const modificata = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creata.id, {
        descrizione: 'Raccolta e trasporto',
        versione: 1,
      })
    )
    expect(modificata).toMatchObject({ versione: 2, descrizione: 'Raccolta e trasporto' })
    const disattivata = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creata.id, { attiva: false, versione: 2 })
    )
    expect(disattivata).toMatchObject({ versione: 3, attiva: false })

    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'CODIFICA_ADDEBITO_' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map(a => a.action)).toEqual([
      'CODIFICA_ADDEBITO_CREATA',
      'CODIFICA_ADDEBITO_MODIFICATA',
      'CODIFICA_ADDEBITO_MODIFICATA',
    ])
    expect((audit[1].metadata as any).campi).toEqual(['descrizione'])
    expect(
      await nel(tenantId, () =>
        service.list(tenantId, { genere: 'GRUPPO', incluseDisattivate: false })
      )
    ).toHaveLength(0)
    expect(
      await nel(tenantId, () =>
        service.list(tenantId, { genere: 'GRUPPO', incluseDisattivate: true })
      )
    ).toHaveLength(1)
  })

  it('creazione rapida senza codice: 001, 002, ..., per genere indipendente; prossimo-codice informativo', async () => {
    const { tenantId, utenteId } = await azienda()
    const a = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { genere: 'CENTRO_RICAVO', descrizione: 'Uno' })
    )
    const b = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, {
        genere: 'CENTRO_RICAVO',
        descrizione: 'Due',
        codice: null,
      })
    )
    const c = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { genere: 'GRUPPO', descrizione: 'Altro genere' })
    )
    expect([a.codice, b.codice, c.codice]).toEqual(['001', '002', '001'])
    expect(await nel(tenantId, () => service.prossimoCodice(tenantId, 'CENTRO_RICAVO'))).toBe('003')
  })

  it('primo codice libero concorrente: due crea in parallelo danno due codici diversi', async () => {
    const { tenantId, utenteId } = await azienda()
    const crea = (descrizione: string) =>
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, { genere: 'CATEGORIA_STATISTICA_1', descrizione })
      )
    const [x, y] = await Promise.all([crea('Prima'), crea('Seconda')])
    expect([x.codice, y.codice].sort()).toEqual(['001', '002'])
  })

  it('due modifiche concorrenti sulla stessa versione: una passa, l’altra 409', async () => {
    const { tenantId, utenteId } = await azienda()
    const creata = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { genere: 'CATEGORIA', descrizione: 'Cat' })
    )
    const tentativo = (descrizione: string) =>
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, creata.id, { descrizione, versione: 1 })
      )
    const esiti = await Promise.allSettled([tentativo('Prima'), tentativo('Seconda')])
    const falliti = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    expect(falliti[0].reason.getResponse().error).toBe('CODIFICA_ADDEBITO_MODIFICATA_NEL_FRATTEMPO')
  })

  it('codice duplicato nello stesso genere: 409; stesso codice in un altro genere o azienda va bene', async () => {
    const a = await azienda()
    const b = await azienda()
    const dati = { genere: 'GRUPPO' as const, codice: '010', descrizione: 'Gruppo' }
    await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    await expect(
      nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'CODIFICA_ADDEBITO_CODICE_DUPLICATO' },
    })
    await expect(
      nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, { ...dati, genere: 'CATEGORIA' }))
    ).resolves.toMatchObject({ codice: '010' })
    await expect(
      nel(b.tenantId, () => service.crea(b.tenantId, b.utenteId, dati))
    ).resolves.toMatchObject({ codice: '010' })
  })

  it('modifica con codice duplicato: 409; con codice vuoto: 400 col messaggio di R2', async () => {
    const { tenantId, utenteId } = await azienda()
    await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { genere: 'GRUPPO', codice: '1', descrizione: 'Uno' })
    )
    const due = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { genere: 'GRUPPO', codice: '2', descrizione: 'Due' })
    )
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, due.id, { codice: '1', versione: 1 })
      )
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'CODIFICA_ADDEBITO_CODICE_DUPLICATO' },
    })
    await expect(
      nel(tenantId, () => service.modifica(tenantId, utenteId, due.id, { codice: '', versione: 1 }))
    ).rejects.toMatchObject({
      status: 400,
      response: { message: ['Il codice ha da 1 a 3 cifre.'] },
    })
  })

  it('elimina con versione giusta cancella; con versione vecchia 409 e la riga resta', async () => {
    const { tenantId, utenteId } = await azienda()
    const creata = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { genere: 'GRUPPO', descrizione: 'Da eliminare' })
    )
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, creata.id, 7))
    ).rejects.toMatchObject({ status: 409 })
    expect(await owner.codificaAddebito.count({ where: { id: creata.id } })).toBe(1)
    await nel(tenantId, () => service.elimina(tenantId, utenteId, creata.id, 1))
    expect(await owner.codificaAddebito.count({ where: { id: creata.id } })).toBe(0)
  })

  it('nel contesto di B la codifica di A è 404 e non compare nell’elenco', async () => {
    const a = await azienda()
    const b = await azienda()
    const creata = await nel(a.tenantId, () =>
      service.crea(a.tenantId, a.utenteId, { genere: 'GRUPPO', descrizione: 'Di A' })
    )
    await expect(
      nel(b.tenantId, () => service.getById(b.tenantId, creata.id))
    ).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      nel(b.tenantId, () =>
        service.modifica(b.tenantId, b.utenteId, creata.id, { attiva: false, versione: 1 })
      )
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      nel(b.tenantId, () => service.elimina(b.tenantId, b.utenteId, creata.id, 1))
    ).rejects.toMatchObject({ status: 404 })
    expect(
      await nel(b.tenantId, () =>
        service.list(b.tenantId, { genere: 'GRUPPO', incluseDisattivate: true })
      )
    ).toHaveLength(0)
  })

  it('in uso da un addebito (gruppo o categoria): eliminabile false, elimina 409 col testo intero', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaCodiciIvaEcodifiche(owner, tenantId)
    await owner.addebito.create({
      data: {
        tenantId,
        codice: '00001',
        descrizione: 'Addebito di prova',
        gruppoId: ids.gruppoId,
        unitaMisura: 'NR',
        categoriaId: ids.categoriaId,
      },
    })
    const elenco = await nel(tenantId, () =>
      service.list(tenantId, { genere: 'GRUPPO', incluseDisattivate: true })
    )
    expect(elenco.find(x => x.id === ids.gruppoId)?.eliminabile).toBe(false)
    expect(
      (await nel(tenantId, () => service.getById(tenantId, ids.categoriaId))).eliminabile
    ).toBe(false)
    expect((await nel(tenantId, () => service.getById(tenantId, ids.centroId))).eliminabile).toBe(
      true
    )
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, ids.gruppoId, 1))
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'CODIFICA_ADDEBITO_IN_USO',
        message: "La codifica è usata da addebiti dell'archivio: disattivala invece di eliminarla.",
      },
    })
    expect(await owner.codificaAddebito.count({ where: { id: ids.gruppoId } })).toBe(1)
  })
})
