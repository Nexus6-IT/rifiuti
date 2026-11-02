/**
 * Variazione dei prezzi dell'archivio (4.2a, Task 10) contro un Postgres reale, collegato COME
 * `wasteflow_app`, dentro il `TenantContext`. Il proprietario prepara le aziende e legge lo stato
 * finale. Pulizia solo per id esatti creati.
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

import { prezzoCalcolato } from '../../domain/listino/importi-riga'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaAddebito, creaCodiciIvaEcodifiche } from '../../test-support/listino-di-test'
import { VariazioniArchivioService } from './variazioni-archivio.service'

describe('VariazioniArchivioService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: VariazioniArchivioService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new VariazioniArchivioService(app)
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
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Variazioni SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-variazioni-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `variazioni-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const rif = await creaCodiciIvaEcodifiche(owner, t.id)
    return { tenantId: t.id, utenteId: utente.id, rif }
  }

  const impostaPrezzi = (addebitoId: string, prezzi: Record<number, string>) =>
    Promise.all(
      Object.entries(prezzi).map(([numero, prezzo]) =>
        owner.prezzoListinoAddebito.updateMany({
          where: { addebitoId, numero: Number(numero) },
          data: { prezzo },
        })
      )
    )

  const prezziDi = async (addebitoId: string) =>
    (
      await owner.prezzoListinoAddebito.findMany({
        where: { addebitoId },
        orderBy: { numero: 'asc' },
      })
    ).map(p => (p.prezzo === null ? null : prezzoCalcolato(p.prezzo.toString())))

  const corpo = (extra: Record<string, unknown> = {}) =>
    ({ tipo: 'AUMENTO_PERCENTUALE', valore: '10', filtri: {}, ...extra }) as any

  async function scenario() {
    const ctx = await azienda()
    const a1 = await creaAddebito(owner, ctx.tenantId, {
      descrizione: 'Trasporto',
      prezzo1: '10',
      categoriaId: ctx.rif.categoriaId,
      codiceIvaId: ctx.rif.iva22Id,
    })
    await impostaPrezzi(a1.id, { 2: '0.0125', 4: '5' })
    const a2 = await creaAddebito(owner, ctx.tenantId, {
      descrizione: 'Pesata',
      prezzo1: '2.5',
      codiceIvaId: ctx.rif.iva22Id,
    })
    await impostaPrezzi(a2.id, { 2: '0' })
    return { ...ctx, a1, a2 }
  }

  it('anteprima per listini 2 e 4 e per categoria: solo quei prezzi, nulla scritto', async () => {
    const { tenantId, rif, a1, a2 } = await scenario()
    const tutti = await nel(tenantId, () =>
      service.anteprima(tenantId, corpo({ filtri: { listini: [2, 4] } }))
    )
    expect(tutti.righe).toEqual([
      expect.objectContaining({ id: a1.id, listino: 2, prima: '0.0125', dopo: '0.0138' }),
      expect.objectContaining({ id: a1.id, listino: 4, prima: '5.00', dopo: '5.50' }),
    ])
    expect(tutti.totale).toBe(2)

    const perCategoria = await nel(tenantId, () =>
      service.anteprima(tenantId, corpo({ filtri: { categorieIds: [rif.categoriaId] } }))
    )
    expect(new Set(perCategoria.righe.map(r => r.id))).toEqual(new Set([a1.id]))
    expect(perCategoria.righe).toHaveLength(3)
    expect(await prezziDi(a1.id)).toEqual(['10.00', '0.0125', null, '5.00', null, null])
    expect(await prezziDi(a2.id)).toEqual(['2.50', '0.00', null, null, null, null])
  })

  it('applica con l’impronta giusta: prezzi nuovi, versione + 1 solo sugli addebiti toccati, un audit', async () => {
    const { tenantId, utenteId, a1, a2 } = await scenario()
    const c = corpo({ filtri: { addebitiIds: [a1.id] } })
    const { impronta } = await nel(tenantId, () => service.anteprima(tenantId, c))
    const esito = await nel(tenantId, () => service.applica(tenantId, utenteId, { ...c, impronta }))
    expect(esito).toEqual({ aggiornati: 3 })
    expect(await prezziDi(a1.id)).toEqual(['11.00', '0.0138', null, '5.50', null, null])
    expect(await prezziDi(a2.id)).toEqual(['2.50', '0.00', null, null, null, null])
    expect((await owner.addebito.findUniqueOrThrow({ where: { id: a1.id } })).versione).toBe(2)
    expect((await owner.addebito.findUniqueOrThrow({ where: { id: a2.id } })).versione).toBe(1)

    const log = await owner.activityLog.findMany({
      where: { tenantId, action: 'PREZZI_ARCHIVIO_VARIATI' },
    })
    expect(log).toHaveLength(1)
    expect(log[0].metadata).toMatchObject({ tipo: 'AUMENTO_PERCENTUALE', addebiti: 1, prezzi: 3 })
    expect(JSON.stringify(log[0].metadata)).not.toContain('Trasporto')
  })

  it('sostituzione IVA sull’addebito: codice IVA nuovo, prezzi e sconti invariati, versione + 1', async () => {
    const { tenantId, utenteId, rif, a1, a2 } = await scenario()
    const c = corpo({
      tipo: 'SOSTITUZIONE_IVA',
      valore: undefined,
      daCodiceIvaId: rif.iva22Id,
      aCodiceIvaId: rif.ivaN61Id,
      filtri: { addebitiIds: [a2.id] },
    })
    const anteprima = await nel(tenantId, () => service.anteprima(tenantId, c))
    expect(anteprima.righe).toEqual([
      { id: a2.id, descrizione: 'Pesata', listino: 0, prima: '22', dopo: 'N61' },
    ])
    const esito = await nel(tenantId, () =>
      service.applica(tenantId, utenteId, { ...c, impronta: anteprima.impronta })
    )
    expect(esito).toEqual({ aggiornati: 1 })
    const dopo2 = await owner.addebito.findUniqueOrThrow({ where: { id: a2.id } })
    expect(dopo2).toMatchObject({ codiceIvaId: rif.ivaN61Id, versione: 2 })
    expect((await owner.addebito.findUniqueOrThrow({ where: { id: a1.id } })).codiceIvaId).toBe(
      rif.iva22Id
    )
    expect(await prezziDi(a2.id)).toEqual(['2.50', '0.00', null, null, null, null])
  })

  it('codice IVA nuovo disattivato: 400', async () => {
    const { tenantId, rif } = await scenario()
    await owner.codiceIva.update({ where: { id: rif.ivaN61Id }, data: { attivo: false } })
    await expect(
      nel(tenantId, () =>
        service.anteprima(
          tenantId,
          corpo({
            tipo: 'SOSTITUZIONE_IVA',
            valore: undefined,
            daCodiceIvaId: rif.iva22Id,
            aCodiceIvaId: rif.ivaN61Id,
          })
        )
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('impronta superata (un addebito modificato dopo l’anteprima): 409 e nulla scritto', async () => {
    const { tenantId, utenteId, a1, a2 } = await scenario()
    const c = corpo()
    const { impronta } = await nel(tenantId, () => service.anteprima(tenantId, c))
    await owner.addebito.update({ where: { id: a2.id }, data: { versione: { increment: 1 } } })
    await expect(
      nel(tenantId, () => service.applica(tenantId, utenteId, { ...c, impronta }))
    ).rejects.toMatchObject({ status: 409, response: { error: 'VARIAZIONE_SUPERATA' } })
    expect(await prezziDi(a1.id)).toEqual(['10.00', '0.0125', null, '5.00', null, null])
    expect(await prezziDi(a2.id)).toEqual(['2.50', '0.00', null, null, null, null])
    expect(
      await owner.activityLog.count({ where: { tenantId, action: 'PREZZI_ARCHIVIO_VARIATI' } })
    ).toBe(0)
  })

  it('due applicazioni in parallelo con la stessa impronta: una passa, l’altra 409, prezzi variati una volta', async () => {
    const { tenantId, utenteId, a1 } = await scenario()
    const c = corpo({ filtri: { addebitiIds: [a1.id] } })
    const { impronta } = await nel(tenantId, () => service.anteprima(tenantId, c))
    const esiti = await Promise.allSettled([
      nel(tenantId, () => service.applica(tenantId, utenteId, { ...c, impronta })),
      nel(tenantId, () => service.applica(tenantId, utenteId, { ...c, impronta })),
    ])
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const rifiutata = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
    expect(rifiutata.reason).toMatchObject({ status: 409 })
    expect(await prezziDi(a1.id)).toEqual(['11.00', '0.0138', null, '5.50', null, null])
  })

  it('risultato negativo: l’anteprima lo segnala, l’applicazione è 400 e non scrive', async () => {
    const { tenantId, utenteId, a1, a2 } = await scenario()
    const c = corpo({ tipo: 'DIMINUZIONE_IMPORTO', valore: '3' })
    const anteprima = await nel(tenantId, () => service.anteprima(tenantId, c))
    expect(anteprima.errori.length).toBeGreaterThan(0)
    await expect(
      nel(tenantId, () =>
        service.applica(tenantId, utenteId, { ...c, impronta: anteprima.impronta })
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(await prezziDi(a1.id)).toEqual(['10.00', '0.0125', null, '5.00', null, null])
    expect(await prezziDi(a2.id)).toEqual(['2.50', '0.00', null, null, null, null])
  })

  it('i contratti non cambiano: nessun contratto creato o modificato dalla variazione', async () => {
    const { tenantId, utenteId } = await scenario()
    const prima = await owner.contrattoCliente.findMany({ where: { tenantId } })
    const c = corpo()
    const { impronta } = await nel(tenantId, () => service.anteprima(tenantId, c))
    await nel(tenantId, () => service.applica(tenantId, utenteId, { ...c, impronta }))
    const dopo = await owner.contrattoCliente.findMany({ where: { tenantId } })
    expect(dopo).toEqual(prima)
  })

  it('isolamento: la variazione non tocca gli addebiti di un’altra azienda', async () => {
    const mia = await scenario()
    const altra = await scenario()
    const c = corpo()
    const { impronta } = await nel(mia.tenantId, () => service.anteprima(mia.tenantId, c))
    await nel(mia.tenantId, () => service.applica(mia.tenantId, mia.utenteId, { ...c, impronta }))
    expect(await prezziDi(altra.a1.id)).toEqual(['10.00', '0.0125', null, '5.00', null, null])
    expect((await owner.addebito.findUniqueOrThrow({ where: { id: altra.a1.id } })).versione).toBe(
      1
    )
    expect(await owner.activityLog.count({ where: { tenantId: altra.tenantId } })).toBe(0)
  })
})
