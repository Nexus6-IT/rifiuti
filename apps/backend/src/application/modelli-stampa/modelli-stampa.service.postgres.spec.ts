/**
 * Modelli di stampa (4.7, T6) contro un Postgres reale, collegato COME `wasteflow_app`, dentro il
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
import { ModelliStampaService } from './modelli-stampa.service'

// 1x1 reale: il logo si prova davvero con il motore PDF (revisione I1).
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// Un secondo PNG valido, diverso dal primo (rosso): per provare che il logo in cache segue le modifiche.
const PNG_ROSSO =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

describe('ModelliStampaService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: ModelliStampaService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new ModelliStampaService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      await owner.companyTemplate.deleteMany({ where: { tenantId: in_ } })
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
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Modelli SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-modelli-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `modelli-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  const dati = (nome: string, o: Record<string, unknown> = {}) => ({
    nome,
    ambito: 'FIR' as const,
    copie: 2,
    testoIntestazione: 'Titolo',
    testoPiePagina: 'Piede',
    colorePrimario: '#112233',
    coloreSecondario: '#445566',
    logoBase64: null,
    ...o,
  })

  const predefinitiPer = (tenantId: string, ambito: 'FIR' | 'GENERALE') =>
    owner.companyTemplate.count({ where: { tenantId, ambito, isDefault: true } })

  it('crea e legge: mappa le colonne, logo salvato come base64 puro (anche da data URL)', async () => {
    const { tenantId, utenteId } = await azienda()
    const creato = await nel(tenantId, () =>
      service.crea(
        tenantId,
        utenteId,
        dati('FIR standard', { logoBase64: `data:image/png;base64,${PNG}` })
      )
    )
    expect(creato).toMatchObject({
      nome: 'FIR standard',
      ambito: 'FIR',
      copie: 2,
      testoIntestazione: 'Titolo',
      testoPiePagina: 'Piede',
      colorePrimario: '#112233',
      coloreSecondario: '#445566',
      logoBase64: PNG,
      predefinito: false,
      versione: 1,
    })
    const riga = await owner.companyTemplate.findUniqueOrThrow({ where: { id: creato.id } })
    expect(riga).toMatchObject({
      name: 'FIR standard',
      headerText: 'Titolo',
      footerText: 'Piede',
      primaryColor: '#112233',
      logoBase64: PNG,
      isDefault: false,
    })
    const elenco = await nel(tenantId, () => service.list(tenantId))
    expect(elenco.map(m => m.id)).toEqual([creato.id])
    await expect(nel(tenantId, () => service.getById(tenantId, creato.id))).resolves.toMatchObject({
      id: creato.id,
    })
  })

  it('rifiuta un logo falso, copie fuori limite e colori non validi con 400', async () => {
    const { tenantId, utenteId } = await azienda()
    const prova = (o: Record<string, unknown>) =>
      nel(tenantId, () => service.crea(tenantId, utenteId, dati('X', o)))
    await expect(
      prova({ logoBase64: Buffer.from('non e un png').toString('base64') })
    ).rejects.toMatchObject({ status: 400 })
    // Firma PNG giusta ma corpo corrotto: non si puo' incorporare nel PDF (revisione I1).
    const pngRotto = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(100, 7)])
    await expect(prova({ logoBase64: pngRotto.toString('base64') })).rejects.toMatchObject({
      status: 400,
    })
    await expect(prova({ copie: 9 })).rejects.toMatchObject({ status: 400 })
    await expect(prova({ colorePrimario: 'rosso' })).rejects.toMatchObject({ status: 400 })
    expect(await owner.companyTemplate.count({ where: { tenantId } })).toBe(0)
  })

  it('un solo predefinito per ambito: il nuovo toglie il flag al vecchio, altri ambiti intatti', async () => {
    const { tenantId, utenteId } = await azienda()
    const a = await nel(tenantId, () => service.crea(tenantId, utenteId, dati('A')))
    const b = await nel(tenantId, () => service.crea(tenantId, utenteId, dati('B')))
    const g = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, dati('G', { ambito: 'GENERALE' }))
    )
    await nel(tenantId, () => service.rendiPredefinito(tenantId, utenteId, g.id, 1))
    const a2 = await nel(tenantId, () => service.rendiPredefinito(tenantId, utenteId, a.id, 1))
    expect(a2).toMatchObject({ predefinito: true, versione: 2 })
    const b2 = await nel(tenantId, () => service.rendiPredefinito(tenantId, utenteId, b.id, 1))
    expect(b2.predefinito).toBe(true)
    const stato = await owner.companyTemplate.findMany({ where: { tenantId } })
    const per = (id: string) => stato.find(r => r.id === id)!
    expect(per(a.id).isDefault).toBe(false)
    expect(per(a.id).versione).toBe(3) // cambia anche il vecchio predefinito: il suo lock sale
    expect(per(b.id).isDefault).toBe(true)
    expect(per(g.id).isDefault).toBe(true)
  })

  it('in concorrenza resta un solo predefinito per ambito, senza errori del database', async () => {
    const { tenantId, utenteId } = await azienda()
    const a = await nel(tenantId, () => service.crea(tenantId, utenteId, dati('A')))
    const b = await nel(tenantId, () => service.crea(tenantId, utenteId, dati('B')))
    const c = await nel(tenantId, () => service.crea(tenantId, utenteId, dati('C')))
    const esiti = await Promise.allSettled(
      [a, b, c].map(m => nel(tenantId, () => service.rendiPredefinito(tenantId, utenteId, m.id, 1)))
    )
    for (const e of esiti) {
      if (e.status === 'rejected') expect(e.reason).toMatchObject({ status: 409 })
    }
    expect(esiti.some(e => e.status === 'fulfilled')).toBe(true)
    expect(await predefinitiPer(tenantId, 'FIR')).toBe(1)
  })

  it('versione vecchia: modifica, predefinito ed elimina rispondono 409 e non scrivono', async () => {
    const { tenantId, utenteId } = await azienda()
    const m = await nel(tenantId, () => service.crea(tenantId, utenteId, dati('V')))
    const modificato = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, m.id, { ...dati('V2'), versione: 1 })
    )
    expect(modificato).toMatchObject({ nome: 'V2', versione: 2 })
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, m.id, { ...dati('V3'), versione: 1 })
      )
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      nel(tenantId, () => service.rendiPredefinito(tenantId, utenteId, m.id, 1))
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, m.id, 1))
    ).rejects.toMatchObject({ status: 409 })
    const riga = await owner.companyTemplate.findUniqueOrThrow({ where: { id: m.id } })
    expect(riga).toMatchObject({ name: 'V2', isDefault: false, versione: 2 })
    await nel(tenantId, () => service.elimina(tenantId, utenteId, m.id, 2))
    expect(await owner.companyTemplate.count({ where: { id: m.id } })).toBe(0)
  })

  it('cambiando ambito a un predefinito il flag si azzera (niente doppio predefinito)', async () => {
    const { tenantId, utenteId } = await azienda()
    const f = await nel(tenantId, () => service.crea(tenantId, utenteId, dati('F')))
    const g = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, dati('G', { ambito: 'GENERALE' }))
    )
    await nel(tenantId, () => service.rendiPredefinito(tenantId, utenteId, f.id, 1))
    await nel(tenantId, () => service.rendiPredefinito(tenantId, utenteId, g.id, 1))
    const spostato = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, f.id, {
        ...dati('F', { ambito: 'GENERALE' }),
        versione: 2,
      })
    )
    expect(spostato).toMatchObject({ ambito: 'GENERALE', predefinito: false })
    expect(await predefinitiPer(tenantId, 'GENERALE')).toBe(1)
    expect(await predefinitiPer(tenantId, 'FIR')).toBe(0)
  })

  it('RLS: un altro tenant non vede, non modifica, non elimina e non rende predefinito', async () => {
    const a = await azienda()
    const b = await azienda()
    const m = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati('Mio')))
    expect(await nel(b.tenantId, () => service.list(b.tenantId))).toEqual([])
    await expect(nel(b.tenantId, () => service.getById(b.tenantId, m.id))).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      nel(b.tenantId, () =>
        service.modifica(b.tenantId, b.utenteId, m.id, { ...dati('Rubato'), versione: 1 })
      )
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      nel(b.tenantId, () => service.rendiPredefinito(b.tenantId, b.utenteId, m.id, 1))
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      nel(b.tenantId, () => service.elimina(b.tenantId, b.utenteId, m.id, 1))
    ).rejects.toMatchObject({ status: 404 })
    expect((await owner.companyTemplate.findUniqueOrThrow({ where: { id: m.id } })).name).toBe(
      'Mio'
    )
  })

  it('scrive l audit senza testo libero', async () => {
    const { tenantId, utenteId } = await azienda()
    const m = await nel(tenantId, () => service.crea(tenantId, utenteId, dati('Audit')))
    await nel(tenantId, () => service.rendiPredefinito(tenantId, utenteId, m.id, 1))
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'MODELLO_STAMPA_' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map(a => a.action)).toEqual([
      'MODELLO_STAMPA_CREATO',
      'MODELLO_STAMPA_PREDEFINITO',
    ])
    expect(JSON.stringify(audit.map(a => a.metadata))).not.toContain('Titolo')
  })

  it('cache dei loghi: la lettura ripetuta e la modifica del logo restano coerenti, due aziende separate', async () => {
    const a = await azienda()
    const b = await azienda()
    const ma = await nel(a.tenantId, () =>
      service.crea(a.tenantId, a.utenteId, dati('A', { logoBase64: PNG }))
    )
    const mb = await nel(b.tenantId, () =>
      service.crea(b.tenantId, b.utenteId, dati('B', { logoBase64: PNG_ROSSO }))
    )
    // due letture di fila (la seconda dalla cache): stesso logo, e mai quello dell'altra azienda
    for (let i = 0; i < 2; i++) {
      const elencoA = await nel(a.tenantId, () => service.list(a.tenantId))
      const elencoB = await nel(b.tenantId, () => service.list(b.tenantId))
      expect(elencoA.map(m => m.logoBase64)).toEqual([PNG])
      expect(elencoB.map(m => m.logoBase64)).toEqual([PNG_ROSSO])
    }
    // l'azienda A non vede il modello di B nemmeno per id
    await expect(nel(a.tenantId, () => service.getById(a.tenantId, mb.id))).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'MODELLO_STAMPA_NON_TROVATO' }),
    })
    // cambia il logo di A: la lettura successiva lo vede subito
    await nel(a.tenantId, () =>
      service.modifica(a.tenantId, a.utenteId, ma.id, {
        ...dati('A', { logoBase64: PNG_ROSSO }),
        versione: 1,
      })
    )
    expect((await nel(a.tenantId, () => service.getById(a.tenantId, ma.id))).logoBase64).toBe(
      PNG_ROSSO
    )
    // e quando lo si toglie, torna null (non il vecchio dalla cache)
    await nel(a.tenantId, () =>
      service.modifica(a.tenantId, a.utenteId, ma.id, {
        ...dati('A', { logoBase64: null }),
        versione: 2,
      })
    )
    expect((await nel(a.tenantId, () => service.getById(a.tenantId, ma.id))).logoBase64).toBeNull()
    // un'altra istanza (cache propria) che legge da zero vede lo stesso
    const altra = new ModelliStampaService(app)
    expect((await nel(a.tenantId, () => altra.getById(a.tenantId, ma.id))).logoBase64).toBeNull()
  })
})
