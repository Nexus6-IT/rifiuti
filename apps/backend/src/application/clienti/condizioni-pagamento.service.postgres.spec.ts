/**
 * Condizioni di pagamento (4.1a) contro un Postgres reale, collegato COME `wasteflow_app`, dentro
 * il `TenantContext`. Il proprietario prepara le aziende e legge lo stato finale. Pulizia solo per
 * id esatti creati (FK a cascata su `tenants`). Include il test della fixture
 * `creaTabelleFatturazione`.
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
import { creaDittaConRuolo, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { creaTabelleFatturazione } from '../../test-support/fatturazione-di-test'
import { CondizioniPagamentoService } from './condizioni-pagamento.service'

describe('CondizioniPagamentoService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: CondizioniPagamentoService
  const tenantCreati: string[] = []
  let n = 0
  let contratti = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new CondizioniPagamentoService(app)
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
        partitaIva: partitaIvaValida(Date.now() + n),
        ragioneSociale: 'Condizioni pagamento SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-condizioni-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `condizioni-${suffisso}@example.com`,
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
    codice: 'RB3060',
    descrizione: 'RiBa 30-60 fine mese',
    modalita: 'MP12' as const,
    giorniRate: [30, 60],
    fineMese: true,
  }

  it('la fixture crea una riga per tabella nel tenant indicato', async () => {
    const { tenantId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    const where = { tenantId }
    expect(await owner.condizionePagamento.count({ where })).toBe(1)
    expect(await owner.contoCorrente.count({ where })).toBe(1)
    expect(await owner.spesaAccessoria.count({ where })).toBe(2)
    expect(await owner.registroIva.count({ where })).toBe(2)
    expect(await owner.testoFatturazione.count({ where })).toBe(1)
    expect(await owner.codificaContratto.count({ where })).toBe(3)
    expect(
      (await owner.registroIva.findUnique({ where: { id: ids.registroSplitId } }))?.ricevuteSplit
    ).toBe(true)
    expect((await owner.spesaAccessoria.findUnique({ where: { id: ids.bolloId } }))?.tipo).toBe(
      'BOLLO'
    )
    expect(new Set(Object.values(ids)).size).toBe(Object.keys(ids).length)
  })

  it('crea, modifica, disattiva: versione 3 e due righe di audit di modifica', async () => {
    const { tenantId, utenteId } = await azienda()
    const creata = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    expect(creata).toMatchObject({
      codice: 'RB3060',
      versione: 1,
      attiva: true,
      descrizioneRate: '30-60 gg fine mese',
      eliminabile: true,
    })

    const modificata = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creata.id, { descrizione: 'RiBa due rate', versione: 1 })
    )
    expect(modificata).toMatchObject({ versione: 2, descrizione: 'RiBa due rate' })

    const disattivata = await nel(tenantId, () =>
      service.modifica(tenantId, utenteId, creata.id, { attiva: false, versione: 2 })
    )
    expect(disattivata).toMatchObject({ versione: 3, attiva: false })

    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'CONDIZIONE_PAGAMENTO_' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map(a => a.action)).toEqual([
      'CONDIZIONE_PAGAMENTO_CREATA',
      'CONDIZIONE_PAGAMENTO_MODIFICATA',
      'CONDIZIONE_PAGAMENTO_MODIFICATA',
    ])
    expect((audit[1].metadata as any).campi).toEqual(['descrizione'])
    expect((audit[2].metadata as any).campi).toEqual(['attiva'])
    expect(audit.every(a => a.userId === utenteId)).toBe(true)

    // la disattivata sparisce dall'elenco di default e torna con il filtro
    expect(await nel(tenantId, () => service.list(tenantId, false))).toHaveLength(0)
    expect(await nel(tenantId, () => service.list(tenantId, true))).toHaveLength(1)
  })

  it('due modifiche concorrenti sulla stessa versione: una passa, l’altra 409', async () => {
    const { tenantId, utenteId } = await azienda()
    const creata = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    const tentativo = (descrizione: string) =>
      nel(tenantId, () =>
        service.modifica(tenantId, utenteId, creata.id, { descrizione, versione: 1 })
      )
    const esiti = await Promise.allSettled([tentativo('Prima'), tentativo('Seconda')])
    const riusciti = esiti.filter(e => e.status === 'fulfilled')
    const falliti = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
    expect(riusciti).toHaveLength(1)
    expect(falliti).toHaveLength(1)
    expect(falliti[0].reason.getStatus()).toBe(409)
    expect(falliti[0].reason.getResponse().error).toBe(
      'CONDIZIONE_PAGAMENTO_MODIFICATA_NEL_FRATTEMPO'
    )
    const riga = await owner.condizionePagamento.findUnique({ where: { id: creata.id } })
    expect(riga?.versione).toBe(2)
  })

  it('codice duplicato nell’azienda: 409 col codice del vincolo; in un’altra azienda va bene', async () => {
    const a = await azienda()
    const b = await azienda()
    await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    await expect(
      nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
    ).rejects.toMatchObject({
      response: { error: 'CONDIZIONE_PAGAMENTO_CODICE_DUPLICATO' },
      status: 409,
    })
    await expect(
      nel(b.tenantId, () => service.crea(b.tenantId, b.utenteId, dati))
    ).resolves.toMatchObject({ codice: 'RB3060' })
  })

  it('elimina con versione giusta cancella; con versione vecchia 409 e la riga resta', async () => {
    const { tenantId, utenteId } = await azienda()
    const creata = await nel(tenantId, () => service.crea(tenantId, utenteId, dati))
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, creata.id, 7))
    ).rejects.toMatchObject({ status: 409 })
    expect(await owner.condizionePagamento.count({ where: { id: creata.id } })).toBe(1)
    await nel(tenantId, () => service.elimina(tenantId, utenteId, creata.id, 1))
    expect(await owner.condizionePagamento.count({ where: { id: creata.id } })).toBe(0)
    const audit = await owner.activityLog.findMany({
      where: { tenantId, action: 'CONDIZIONE_PAGAMENTO_ELIMINATA' },
    })
    expect(audit).toHaveLength(1)
  })

  it('nel contesto di B la condizione di A è 404 (lettura, modifica, eliminazione)', async () => {
    const a = await azienda()
    const b = await azienda()
    const creata = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati))
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
    expect(await nel(b.tenantId, () => service.list(b.tenantId, true))).toHaveLength(0)
    const riga = await owner.condizionePagamento.findUnique({ where: { id: creata.id } })
    expect(riga?.versione).toBe(1)
  })

  it('in uso da un cliente: elimina 409, la riga resta, eliminabile false', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await clienteConRiferimento(tenantId, { condizionePagamentoId: ids.condizioneId })
    const v = await nel(tenantId, () => service.getById(tenantId, ids.condizioneId))
    expect(v.eliminabile).toBe(false)
    const elenco = await nel(tenantId, () => service.list(tenantId, true))
    expect(elenco.find(x => x.id === ids.condizioneId)?.eliminabile).toBe(false)
    await expect(
      nel(tenantId, () => service.elimina(tenantId, utenteId, ids.condizioneId, 1))
    ).rejects.toMatchObject({
      status: 409,
      response: {
        error: 'CONDIZIONE_PAGAMENTO_IN_USO',
        message:
          'La condizione di pagamento è usata da clienti o contratti: disattivala invece di eliminarla.',
      },
    })
    expect(await owner.condizionePagamento.count({ where: { id: ids.condizioneId } })).toBe(1)
  })

  it('il messaggio di una femminile dice "disattivala"', async () => {
    const { tenantId, utenteId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await contrattoConRiferimento(tenantId, { condizionePagamentoId: ids.condizioneId })
    const e = await nel(tenantId, () =>
      service.elimina(tenantId, utenteId, ids.condizioneId, 1)
    ).catch(x => x)
    expect(e.getResponse().message).toContain('disattivala invece di eliminarla')
  })

  it('citata solo da un contratto eliminato: eliminabile false, la FK lo vede (R23)', async () => {
    const { tenantId } = await azienda()
    const ids = await creaTabelleFatturazione(owner, tenantId)
    await contrattoConRiferimento(tenantId, {
      condizionePagamentoId: ids.condizioneId,
      eliminatoIl: new Date(),
    })
    const v = await nel(tenantId, () => service.getById(tenantId, ids.condizioneId))
    expect(v.eliminabile).toBe(false)
  })
})
