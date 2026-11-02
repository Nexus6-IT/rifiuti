/**
 * Archivio degli addebiti (4.2a) contro un Postgres reale, collegato COME `wasteflow_app`, dentro
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
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaAddebito, creaCodiciIvaEcodifiche } from '../../test-support/listino-di-test'

import { AddebitiService } from './addebiti.service'
import { VariazioniArchivioService } from './variazioni-archivio.service'
import { controllaRiferimentiListino } from './riferimenti-listino'

describe('AddebitiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: AddebitiService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new AddebitiService(app)
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
        ragioneSociale: 'Addebiti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-addebiti-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `addebiti-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const rif = await creaCodiciIvaEcodifiche(owner, t.id)
    return { tenantId: t.id, utenteId: utente.id, rif }
  }

  const base = (rif: { gruppoId: string }, extra: Record<string, unknown> = {}) => ({
    descrizione: 'Trasporto',
    gruppoId: rif.gruppoId,
    unitaMisura: 'kg',
    ...extra,
  })

  it('crea con sei listini e rilegge: sempre 6, vuoti null, prezzi nella forma d’uscita', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const creato = await nel(tenantId, () =>
      service.crea(
        tenantId,
        utenteId,
        base(rif, {
          codice: '12',
          codiceIvaId: rif.iva22Id,
          categoriaId: rif.categoriaId,
          centroRicavoId: rif.centroId,
          categoriaStatistica1Id: rif.stat1Id,
          categoriaStatistica2Id: rif.stat2Id,
          tipo: 'V',
          tipoProvvigione: 'LORDO',
          listini: [
            { numero: 1, prezzo: '10,5', sconto: '10+5', provvigione: '3' },
            { numero: 4, prezzo: '0.0125' },
          ],
        })
      )
    )
    expect(creato).toMatchObject({
      codice: '00012',
      unitaMisura: 'KG',
      tipoProvvigione: 'LORDO',
      attivo: true,
      versione: 1,
      eliminabile: true,
      gruppo: { id: rif.gruppoId, codice: '001' },
      codiceIva: { id: rif.iva22Id, codice: '22' },
      categoria: { id: rif.categoriaId },
      centroRicavo: { id: rif.centroId },
      categoriaStatistica1: { id: rif.stat1Id },
      categoriaStatistica2: { id: rif.stat2Id },
    })
    expect(creato.listini).toHaveLength(6)
    expect(creato.listini.map(l => l.numero)).toEqual([1, 2, 3, 4, 5, 6])
    expect(creato.listini[0]).toEqual({
      numero: 1,
      prezzo: '10.50',
      sconto: '10+5',
      provvigione: '3',
    })
    expect(creato.listini[1]).toEqual({ numero: 2, prezzo: null, sconto: null, provvigione: null })
    expect(creato.listini[3].prezzo).toBe('0.0125')

    const letto = await nel(tenantId, () => service.getById(tenantId, creato.id))
    expect(letto).toEqual(creato)
    expect(await owner.prezzoListinoAddebito.count({ where: { addebitoId: creato.id } })).toBe(6)
  })

  it('prossimo-codice: 00001 senza addebiti, poi il primo libero (anche un buco)', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    expect(await nel(tenantId, () => service.prossimoCodice(tenantId))).toBe('00001')
    await nel(tenantId, () => service.crea(tenantId, utenteId, base(rif, { codice: '1' })))
    await nel(tenantId, () => service.crea(tenantId, utenteId, base(rif, { codice: '3' })))
    expect(await nel(tenantId, () => service.prossimoCodice(tenantId))).toBe('00002')
  })

  it('senza codice: assegna il primo libero; due crea in parallelo danno due codici diversi', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const primo = await nel(tenantId, () => service.crea(tenantId, utenteId, base(rif)))
    expect(primo.codice).toBe('00001')
    const { tenantId: t2, utenteId: u2, rif: r2 } = await azienda()
    const [a, b] = await Promise.all([
      nel(t2, () => service.crea(t2, u2, base(r2, { descrizione: 'A' }))),
      nel(t2, () => service.crea(t2, u2, base(r2, { descrizione: 'B' }))),
    ])
    expect([a.codice, b.codice].sort()).toEqual(['00001', '00002'])
  })

  it('creazione senza codice con un addebito bloccato da un’altra transazione (come una variazione in corso): non aspetta e non è un 500', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const prima = await nel(tenantId, () => service.crea(tenantId, utenteId, base(rif)))
    let rilascia!: () => void
    let presa!: () => void
    const cancello = new Promise<void>(r => (rilascia = r))
    const lockPreso = new Promise<void>(r => (presa = r))
    const tenuta = owner.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM addebiti WHERE id = ${prima.id}::uuid FOR NO KEY UPDATE`
        presa()
        await cancello
      },
      { timeout: 30000 }
    )
    await lockPreso
    try {
      const nuovo = await nel(tenantId, () =>
        service.crea(tenantId, utenteId, base(rif, { descrizione: 'Seconda' }))
      )
      expect(nuovo.codice).toBe('00002')
    } finally {
      rilascia()
      await tenuta
    }
  }, 20000)

  it('creazioni senza codice concorrenti a un’applica di variazione: ogni esito è un successo o un 409, mai un 500', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const variazioni = new VariazioniArchivioService(app)
    for (let i = 0; i < 12; i++) {
      await creaAddebito(owner, tenantId, {
        descrizione: `Voce ${i}`,
        prezzo1: '10',
        codiceIvaId: rif.iva22Id,
      })
    }
    const c = { tipo: 'AUMENTO_PERCENTUALE', valore: '10', filtri: {} } as any
    const { impronta } = await nel(tenantId, () => variazioni.anteprima(tenantId, c))
    const esiti = await Promise.allSettled([
      nel(tenantId, () => variazioni.applica(tenantId, utenteId, { ...c, impronta })),
      ...[1, 2, 3, 4].map(i =>
        nel(tenantId, () => service.crea(tenantId, utenteId, base(rif, { descrizione: `N${i}` })))
      ),
    ])
    for (const e of esiti) {
      if (e.status === 'rejected') expect(e.reason).toMatchObject({ status: 409 })
    }
    const codici = (await owner.addebito.findMany({ where: { tenantId } })).map(a => a.codice)
    expect(new Set(codici).size).toBe(codici.length)
  }, 30000)

  it('codice duplicato: 409 in creazione e in modifica', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const uno = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, base(rif, { codice: '5' }))
    )
    await expect(
      nel(tenantId, () => service.crea(tenantId, utenteId, base(rif, { codice: '5' })))
    ).rejects.toMatchObject({ status: 409, response: { error: 'ADDEBITO_CODICE_DUPLICATO' } })
    const due = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, base(rif, { codice: '6' }))
    )
    await expect(
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, due.id, { codice: '5', versione: 1 })
      )
    ).rejects.toMatchObject({ status: 409, response: { error: 'ADDEBITO_CODICE_DUPLICATO' } })
    expect(uno.codice).toBe('00005')
  })

  it('riferimenti di genere sbagliato o disattivati: 400, nulla scritto', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, base({ gruppoId: rif.categoriaId }, { codice: '1' }))
      )
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: ['Il gruppo scelto non esiste, è disattivato o non è un gruppo.'],
      },
    })
    await owner.codiceIva.update({ where: { id: rif.iva22Id }, data: { attivo: false } })
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, base(rif, { codice: '1', codiceIvaId: rif.iva22Id }))
      )
    ).rejects.toMatchObject({
      status: 400,
      response: { message: ['Il codice IVA scelto non esiste o è disattivato.'] },
    })
    expect(await owner.addebito.count({ where: { tenantId } })).toBe(0)
  })

  it('riferimento di un’altra azienda: 400 (non esiste per questa azienda)', async () => {
    const { tenantId, utenteId } = await azienda()
    const altra = await azienda()
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, base({ gruppoId: altra.rif.gruppoId }, { codice: '1' }))
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('i riferimenti sono letti con FOR SHARE: una disattivazione concorrente aspetta', async () => {
    const { tenantId, rif } = await azienda()
    await nel(tenantId, () =>
      app.$transaction(async tx => {
        const errori = await controllaRiferimentiListino(tx, tenantId, {
          gruppoId: rif.gruppoId,
          codiceIvaId: rif.iva22Id,
        })
        expect(errori).toEqual([])
        // Finche' la transazione e' aperta le righe sono bloccate: FOR UPDATE NOWAIT fallisce.
        await expect(
          owner.$queryRaw`SELECT id FROM codifiche_addebito WHERE id = ${rif.gruppoId}::uuid FOR UPDATE NOWAIT`
        ).rejects.toThrow()
        await expect(
          owner.$queryRaw`SELECT id FROM codici_iva WHERE id = ${rif.iva22Id}::uuid FOR UPDATE NOWAIT`
        ).rejects.toThrow()
      })
    )
    // A transazione chiusa il lock e' rilasciato.
    await expect(
      owner.$queryRaw`SELECT id FROM codifiche_addebito WHERE id = ${rif.gruppoId}::uuid FOR UPDATE NOWAIT`
    ).resolves.toHaveLength(1)
  })

  it('modifica campi e listini nella stessa scrittura: versione +1, listini sostituiti in blocco, audit', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const creato = await nel(tenantId, () =>
      service.crea(
        tenantId,
        utenteId,
        base(rif, {
          codice: '9',
          listini: [
            { numero: 1, prezzo: '1' },
            { numero: 2, prezzo: '2' },
          ],
        })
      )
    )
    const m = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creato.id, {
        versione: 1,
        descrizione: 'Nuovo nome',
        codiceIvaId: rif.ivaN61Id,
        listini: [{ numero: 3, prezzo: '3,25', sconto: '5' }],
      })
    )
    expect(m).toMatchObject({
      versione: 2,
      descrizione: 'Nuovo nome',
      codiceIva: { codice: 'N61' },
    })
    expect(m.listini.map(l => l.prezzo)).toEqual([null, null, '3.25', null, null, null])
    expect(m.listini[2].sconto).toBe('5')
    expect(await owner.prezzoListinoAddebito.count({ where: { addebitoId: creato.id } })).toBe(6)

    // Azzera un riferimento facoltativo con null; stesso contenuto: nessuna nuova versione.
    const senzaIva = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creato.id, { versione: 2, codiceIvaId: null })
    )
    expect(senzaIva).toMatchObject({ versione: 3, codiceIva: null })
    const invariata = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creato.id, { versione: 3, descrizione: 'Nuovo nome' })
    )
    expect(invariata.versione).toBe(3)

    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'ADDEBITO_' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map(a => a.action)).toEqual([
      'ADDEBITO_CREATO',
      'ADDEBITO_MODIFICATO',
      'ADDEBITO_MODIFICATO',
    ])
    expect((audit[1].metadata as any).campi).toEqual(['descrizione', 'codiceIvaId', 'listini'])
  })

  it('versione vecchia: 409; due modifiche concorrenti sulla stessa versione: una passa, l’altra 409', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const creato = await nel(tenantId, () => service.crea(tenantId, utenteId, base(rif)))
    const tentativo = (descrizione: string) =>
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, creato.id, {
          descrizione,
          listini: [{ numero: 1, prezzo: '7' }],
          versione: 1,
        })
      )
    const esiti = await Promise.allSettled([tentativo('Prima'), tentativo('Seconda')])
    const falliti = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    expect(falliti).toHaveLength(1)
    expect(falliti[0].reason.getStatus()).toBe(409)
    expect(falliti[0].reason.getResponse().error).toBe('ADDEBITO_MODIFICATO_NEL_FRATTEMPO')
    // I listini non sono stati toccati dal perdente: sempre sei.
    expect(await owner.prezzoListinoAddebito.count({ where: { addebitoId: creato.id } })).toBe(6)
    await expect(tentativo('Terza')).rejects.toMatchObject({ status: 409 })
  })

  it('tipo T con unità di misura non di peso: 400', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, base(rif, { tipo: 'TS', unitaMisura: 'PZ' }))
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('elimina fisica con i sei listini; versione vecchia 409; inesistente 404; contaUsi resta 0', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const creato = await nel(tenantId, () => service.crea(tenantId, utenteId, base(rif)))
    expect(creato.eliminabile).toBe(true)
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, creato.id, 5))
    ).rejects.toMatchObject({ status: 409 })
    await nel(tenantId, () => service.elimina(tenantId, utenteId, creato.id, 1))
    expect(await owner.addebito.count({ where: { id: creato.id } })).toBe(0)
    expect(await owner.prezzoListinoAddebito.count({ where: { addebitoId: creato.id } })).toBe(0)
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, creato.id, 1))
    ).rejects.toMatchObject({ status: 404 })
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: 'ADDEBITO_ELIMINATO' },
    })
    expect(audit).toHaveLength(1)
  })

  it('una codifica citata da un addebito risulta in uso (non eliminabile)', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    await nel(tenantId, () => service.crea(tenantId, utenteId, base(rif)))
    const codifiche = await import('./codifiche-addebito.service')
    const cod = new codifiche.CodificheAddebitoService(app)
    const g = await nel(tenantId, () => cod.getById(tenantId, rif.gruppoId))
    expect(g.eliminabile).toBe(false)
  })

  it('audit senza appunti né nota d’uso interno né descrizione', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    const v = await nel(tenantId, () =>
      service.crea(
        tenantId,
        utenteId,
        base(rif, { appunti: 'segreto-appunti', notaUsoInterno: 'segreto-nota' })
      )
    )
    await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, v.id, { versione: 1, appunti: 'altro-segreto' })
    )
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'ADDEBITO_' } },
    })
    expect(audit).toHaveLength(2)
    const json = JSON.stringify(audit.map(a => [a.description, a.metadata]))
    expect(json).not.toContain('segreto')
    expect(json).not.toContain('Trasporto')
    expect(json).not.toContain('notaUsoInterno')
  })

  it('list: filtro testo su codice e descrizione, tipo, soloAttivi, paginazione e totale', async () => {
    const { tenantId, utenteId, rif } = await azienda()
    for (let i = 1; i <= 5; i++) {
      await nel(tenantId, () =>
        service.crea(tenantId, utenteId, base(rif, { codice: String(i), descrizione: `Voce ${i}` }))
      )
    }
    const fx = await creaAddebito(owner, tenantId, {
      gruppoId: rif.gruppoId,
      codice: '777',
      descrizione: 'Fisso mensile',
      tipo: 'F',
      attivo: false,
    })
    const tutti = await nel(tenantId, () => service.list(tenantId, { pagina: 1, dimensione: 25 }))
    expect(tutti.totale).toBe(6)
    // gli attivi prima, poi per codice
    expect(tutti.elementi.map(e => e.codice)).toEqual([
      '00001',
      '00002',
      '00003',
      '00004',
      '00005',
      '00777',
    ])
    const p2 = await nel(tenantId, () => service.list(tenantId, { pagina: 2, dimensione: 4 }))
    expect(p2.totale).toBe(6)
    expect(p2.elementi.map(e => e.codice)).toEqual(['00005', '00777'])
    const perDescrizione = await nel(tenantId, () =>
      service.list(tenantId, { testo: 'mensile', pagina: 1, dimensione: 25 })
    )
    expect(perDescrizione.elementi.map(e => e.id)).toEqual([fx.id])
    const perCodice = await nel(tenantId, () =>
      service.list(tenantId, { testo: '00003', pagina: 1, dimensione: 25 })
    )
    expect(perCodice.elementi.map(e => e.codice)).toEqual(['00003'])
    const perTipo = await nel(tenantId, () =>
      service.list(tenantId, { tipo: 'F', pagina: 1, dimensione: 25 })
    )
    expect(perTipo.totale).toBe(1)
    const attivi = await nel(tenantId, () =>
      service.list(tenantId, { soloAttivi: true, pagina: 1, dimensione: 25 })
    )
    expect(attivi.totale).toBe(5)
  })

  it('isolamento fra aziende: un altro tenant non vede né modifica', async () => {
    const a = await azienda()
    const b = await azienda()
    const v = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, base(a.rif)))
    await expect(nel(b.tenantId, () => service.getById(b.tenantId, v.id))).rejects.toMatchObject({
      status: 404,
    })
    expect(
      (await nel(b.tenantId, () => service.list(b.tenantId, { pagina: 1, dimensione: 25 }))).totale
    ).toBe(0)
  })
})
