/**
 * Clienti (4.1b) contro un Postgres reale, collegato COME `wasteflow_app`, dentro il
 * `TenantContext`. Il proprietario prepara le aziende, le tabelle di fatturazione e le righe che
 * il servizio non crea. Pulizia solo per id esatti creati.
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
import {
  CF_PERSONA_VALIDO,
  creaDittaConRuolo,
  partitaIvaValida,
} from '../../test-support/anagrafiche-di-test'
import { creaTabelleFatturazione } from '../../test-support/fatturazione-di-test'
import { DitteService } from '../registry/ditte/ditte.service'
import { ClientiService } from './clienti.service'

describe('ClientiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let ditte: DitteService
  let service: ClientiService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    ditte = new DitteService(app, new DittaPrismaRepository())
    service = new ClientiService(app, ditte)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      // Le FK composite fra clienti/contratti/agenti e ditte sono NoAction: prima le righe che
      // citano, poi quelle citate (allegati, periodi, contratti, clienti, agenti), sempre per id.
      const in_ = { in: tenantCreati }
      await owner.allegatoContrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.periodoFatturazioneCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.cliente.deleteMany({ where: { tenantId: in_ } })
      await owner.agente.deleteMany({ where: { tenantId: in_ } })
      await owner.produttore.deleteMany({ where: { tenantId: in_ } })
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
        ragioneSociale: 'Clienti SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-clienti-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `clienti-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: utente.id }
  }

  const indirizzo = { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' }
  const nuovo = (extra: Record<string, unknown> = {}) => ({
    ragioneSociale: `Cliente ${++n}`,
    partitaIva: partitaIvaValida(Date.now() + ++n),
    indirizzo,
    ...extra,
  })

  it('crea un cliente su una ditta nuova con condizione, conto, registro, spese, bollo e agente', async () => {
    const { tenantId, utenteId } = await azienda()
    const t = await creaTabelleFatturazione(owner, tenantId)
    const agente = await creaDittaConRuolo(owner, tenantId, 'AGENTE', {
      ragioneSociale: 'Agenzia Verdi',
    })
    const dati = nuovo({
      codice: 'CL1',
      note: 'Pagatore puntuale',
      condizionePagamentoId: t.condizioneId,
      contoCorrenteId: t.contoId,
      registroIvaId: t.registroId,
      speseIncassoId: t.speseId,
      bolloId: t.bolloId,
      agenteId: agente.ruoloId,
      esigibilitaIva: 'SCISSIONE',
      ritenutaPercentuale: '4,5',
      codiceDestinatario: 'abcdefg',
    })
    const r = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    expect(r).toMatchObject({
      dittaEsistente: false,
      avvisi: [],
      cliente: {
        codice: 'CL1',
        attivo: true,
        versione: 1,
        contratti: 0,
        eliminabile: true,
        esigibilitaIva: 'SCISSIONE',
        ritenutaPercentuale: '4.50',
        codiceDestinatario: 'ABCDEFG',
        ditta: { ragioneSociale: dati.ragioneSociale, partitaIva: dati.partitaIva, privato: false },
        sedeFatturazione: { citta: 'Roma', principale: true, attiva: true },
        condizionePagamento: { id: t.condizioneId, codice: 'BB30' },
        contoCorrente: { id: t.contoId, codice: 'C1' },
        registroIva: { id: t.registroId, codice: '01' },
        speseIncasso: { id: t.speseId, codice: 'INC' },
        bollo: { id: t.bolloId, codice: 'BOL' },
        agente: { id: agente.ruoloId, descrizione: 'Agenzia Verdi' },
      },
    })
    const letto = await nel(tenantId, () => service.getById(tenantId, r.cliente.id))
    expect(letto).toEqual(r.cliente)
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: 'CLIENTE_CREATO' },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0].metadata).toEqual({
      clienteId: r.cliente.id,
      dittaId: r.cliente.ditta.id,
      dittaEsistente: false,
    })
  })

  it('su una ditta già produttore: dittaEsistente true, stessa ditta, ruoli con produttoreId e clienteId', async () => {
    const { tenantId, utenteId } = await azienda()
    const prod = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Ditta Mista',
    })
    const piva = (await owner.ditta.findUniqueOrThrow({ where: { id: prod.dittaId } })).partitaIva
    const r = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, nuovo({ partitaIva: piva, ragioneSociale: 'Ditta Mista' }))
    )
    expect(r.dittaEsistente).toBe(true)
    expect(r.cliente.ditta.id).toBe(prod.dittaId)
    const dto = await nel(tenantId, () => ditte.dettaglio(prod.dittaId))
    expect(dto.ruoli).toMatchObject({ produttoreId: prod.ruoloId, clienteId: r.cliente.id })
  })

  it('privato con nome e cognome: creato', async () => {
    const { tenantId, utenteId } = await azienda()
    const cf = CF_PERSONA_VALIDO
    const r = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, {
        ragioneSociale: 'Mario Rossi',
        codiceFiscale: cf,
        indirizzo,
        nome: 'Mario',
        cognome: 'Rossi',
      })
    )
    expect(r.cliente).toMatchObject({
      nome: 'Mario',
      cognome: 'Rossi',
      ditta: { privato: true, partitaIva: null, codiceFiscale: cf },
    })
    // il codice fiscale non e' nell'audit
    const audit = await owner.activityLog.findMany({ where: { tenantId } })
    expect(JSON.stringify(audit)).not.toContain(cf)
  })

  it('privato senza nome: 400 e nessuna ditta creata', async () => {
    const { tenantId, utenteId } = await azienda()
    const prima = await owner.ditta.count({ where: { tenantId } })
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, {
          ragioneSociale: 'Mario Rossi',
          codiceFiscale: CF_PERSONA_VALIDO,
          indirizzo,
          cognome: 'Rossi',
        })
      )
    ).rejects.toMatchObject({
      status: 400,
      response: {
        error: 'CLIENTE_NON_VALIDO',
        message: ['Per un cliente persona fisica indica nome e cognome.'],
      },
    })
    expect(await owner.ditta.count({ where: { tenantId } })).toBe(prima)
    expect(await owner.cliente.count({ where: { tenantId } })).toBe(0)
  })

  it('riferimenti non validi dopo la creazione della ditta: 400 e la ditta non resta (atomicità)', async () => {
    const { tenantId, utenteId } = await azienda()
    const t = await creaTabelleFatturazione(owner, tenantId)
    const prima = await owner.ditta.count({ where: { tenantId } })
    await expect(
      nel(tenantId, () => service.crea(tenantId, utenteId, nuovo({ bolloId: t.speseId })))
    ).rejects.toMatchObject({ status: 400 })
    expect(await owner.ditta.count({ where: { tenantId } })).toBe(prima)
  })

  it('bollo con una spesa INCASSO: 400', async () => {
    const { tenantId, utenteId } = await azienda()
    const t = await creaTabelleFatturazione(owner, tenantId)
    await expect(
      nel(tenantId, () => service.crea(tenantId, utenteId, nuovo({ bolloId: t.speseId })))
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: ['La spesa di bollo scelta non esiste, è disattivata o non è una spesa di bollo.'],
      },
    })
  })

  it('registro delle ricevute split: 400', async () => {
    const { tenantId, utenteId } = await azienda()
    const t = await creaTabelleFatturazione(owner, tenantId)
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, nuovo({ registroIvaId: t.registroSplitId }))
      )
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: [
          'Il registro delle ricevute split payment non si usa per le fatture del contratto.',
        ],
      },
    })
  })

  it('riferimento disattivato o di un agente disattivato: 400', async () => {
    const { tenantId, utenteId } = await azienda()
    const t = await creaTabelleFatturazione(owner, tenantId)
    const agente = await creaDittaConRuolo(owner, tenantId, 'AGENTE')
    await owner.agente.update({ where: { id: agente.ruoloId }, data: { attivo: false } })
    await owner.contoCorrente.update({ where: { id: t.contoId }, data: { attivo: false } })
    await expect(
      nel(tenantId, () =>
        service.crea(
          tenantId,
          utenteId,
          nuovo({ contoCorrenteId: t.contoId, agenteId: agente.ruoloId })
        )
      )
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: [
          'Il conto corrente scelto non esiste o è disattivato.',
          "L'agente scelto non esiste o è disattivato.",
        ],
      },
    })
  })

  it('conto di B nel contesto di A: 400', async () => {
    const a = await azienda()
    const b = await azienda()
    const tb = await creaTabelleFatturazione(owner, b.tenantId)
    await expect(
      nel(a.tenantId, () =>
        service.crea(a.tenantId, a.utenteId, nuovo({ contoCorrenteId: tb.contoId }))
      )
    ).rejects.toMatchObject({
      status: 400,
      response: { message: ['Il conto corrente scelto non esiste o è disattivato.'] },
    })
  })

  it('sedeId: usata se è una sede attiva della ditta, altrimenti 400', async () => {
    const { tenantId, utenteId } = await azienda()
    const altraDitta = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE')
    await expect(
      nel(tenantId, () => service.crea(tenantId, utenteId, nuovo({ sedeId: altraDitta.sedeId })))
    ).rejects.toMatchObject({
      name: 'SedeNonValidaPerRuoloError',
      message: expect.stringContaining('del cliente'),
    })
    // ditta esistente con una seconda sede: la scelta della sede vale
    const piva = (await owner.ditta.findUniqueOrThrow({ where: { id: altraDitta.dittaId } }))
      .partitaIva
    const seconda = await nel(tenantId, () =>
      ditte.aggiungiSede(altraDitta.dittaId, {
        indirizzo: {
          via: 'Via Milano',
          civico: '2',
          cap: '20100',
          citta: 'Milano',
          provincia: 'MI',
        },
      })
    )
    const r = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, nuovo({ partitaIva: piva, sedeId: seconda.id }))
    )
    expect(r.cliente.sedeFatturazione.id).toBe(seconda.id)
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
      response: { message: 'Esiste già un cliente per questa ditta' },
    })
    expect(await owner.cliente.count({ where: { tenantId } })).toBe(1)
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
      response: { error: 'CLIENTE_CODICE_DUPLICATO' },
    })
  })

  it('ricerca per P.IVA, ragione sociale e codice (mai per codice fiscale)', async () => {
    const { tenantId, utenteId } = await azienda()
    const a = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, nuovo({ ragioneSociale: 'Alfa Servizi', codice: 'ALFA1' }))
    )
    await nel(tenantId, () =>
      service.crea(tenantId, utenteId, nuovo({ ragioneSociale: 'Beta Servizi', codice: 'BETA1' }))
    )
    await nel(tenantId, () =>
      service.crea(tenantId, utenteId, {
        ragioneSociale: 'Gamma Privato',
        codiceFiscale: CF_PERSONA_VALIDO,
        indirizzo,
        nome: 'Mario',
        cognome: 'Rossi',
      })
    )
    const cerca = (testo: string) =>
      nel(tenantId, () => service.list(tenantId, { testo, pagina: 1, dimensione: 25 })).then(r =>
        r.elementi.map(e => e.ditta.ragioneSociale)
      )
    expect(await cerca('servizi')).toEqual(['Alfa Servizi', 'Beta Servizi'])
    expect(await cerca('beta1')).toEqual(['Beta Servizi'])
    expect(await cerca(a.cliente.ditta.partitaIva as string)).toEqual(['Alfa Servizi'])
    expect(await cerca(CF_PERSONA_VALIDO)).toEqual([])
    expect(await cerca('a')).toHaveLength(3) // un solo carattere: nessun filtro
  })

  it('paginazione: totale e pagina 2, soloAttivi', async () => {
    const { tenantId, utenteId } = await azienda()
    for (const nome of ['Uno', 'Due', 'Tre']) {
      await nel(tenantId, () =>
        service.crea(tenantId, utenteId, nuovo({ ragioneSociale: `${nome} Pagina` }))
      )
    }
    const p1 = await nel(tenantId, () => service.list(tenantId, { pagina: 1, dimensione: 2 }))
    const p2 = await nel(tenantId, () => service.list(tenantId, { pagina: 2, dimensione: 2 }))
    expect(p1.totale).toBe(3)
    expect(p2.totale).toBe(3)
    expect(p1.elementi.map(e => e.ditta.ragioneSociale)).toEqual(['Due Pagina', 'Tre Pagina'])
    expect(p2.elementi.map(e => e.ditta.ragioneSociale)).toEqual(['Uno Pagina'])
    await owner.cliente.updateMany({
      where: { tenantId, ditta: { ragioneSociale: 'Uno Pagina' } },
      data: { attivo: false },
    })
    const attivi = await nel(tenantId, () =>
      service.list(tenantId, { soloAttivi: true, pagina: 1, dimensione: 25 })
    )
    expect(attivi.totale).toBe(2)
  })

  it('contratti ed eliminabile: i contratti eliminati non si contano ma bloccano l’eliminazione (R25)', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await nel(tenantId, () => service.crea(tenantId, utenteId, nuovo()))
    const id = r.cliente.id
    const contratto = (numero: string, eliminatoIl: Date | null, intestatario?: string) =>
      owner.contrattoCliente.create({
        data: {
          tenantId,
          numero,
          descrizione: 'Contratto di prova',
          dataInizio: new Date('2026-01-01'),
          clienteId: intestatario ?? id,
          ...(intestatario ? { clienteFatturazioneId: id } : {}),
          eliminatoIl,
        },
      })
    await contratto('1/2026', new Date())
    const soloEliminato = await nel(tenantId, () => service.getById(tenantId, id))
    expect(soloEliminato).toMatchObject({ contratti: 0, eliminabile: false })

    await contratto('2/2026', null)
    const altro = await nel(tenantId, () => service.crea(tenantId, utenteId, nuovo()))
    await contratto('3/2026', null, altro.cliente.id)
    const vivo = await nel(tenantId, () => service.getById(tenantId, id))
    expect(vivo).toMatchObject({ contratti: 2, eliminabile: false })
    const lista = await nel(tenantId, () => service.list(tenantId, { pagina: 1, dimensione: 25 }))
    expect(lista.elementi.find(e => e.id === id)).toMatchObject({ contratti: 2 })
    expect(lista.elementi.find(e => e.id === altro.cliente.id)).toMatchObject({ contratti: 1 })
  })

  it('attiviPerId: stato e predefiniti dei clienti dell’azienda, nessuno di un’altra', async () => {
    const a = await azienda()
    const b = await azienda()
    const t = await creaTabelleFatturazione(owner, a.tenantId)
    const ra = await nel(a.tenantId, () =>
      service.crea(a.tenantId, a.utenteId, nuovo({ condizionePagamentoId: t.condizioneId }))
    )
    const rb = await nel(b.tenantId, () => service.crea(b.tenantId, b.utenteId, nuovo()))
    const m = await nel(a.tenantId, () =>
      app.$transaction(tx => service.attiviPerId(tx, [ra.cliente.id, rb.cliente.id]))
    )
    expect([...m.keys()]).toEqual([ra.cliente.id])
    expect(m.get(ra.cliente.id)).toMatchObject({
      attivo: true,
      dittaId: ra.cliente.ditta.id,
      condizionePagamentoId: t.condizioneId,
      esigibilitaIva: 'IMMEDIATA',
    })
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
      nel(b.tenantId, () => service.getById(b.tenantId, r.cliente.id))
    ).rejects.toMatchObject({ status: 404, response: { error: 'CLIENTE_NON_TROVATO' } })
  })
})
