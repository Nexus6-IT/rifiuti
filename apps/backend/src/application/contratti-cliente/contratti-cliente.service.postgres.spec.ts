/**
 * Contratti cliente (4.1b, Task 16) contro un Postgres reale, collegato COME `wasteflow_app`,
 * dentro il `TenantContext`. Il proprietario prepara le aziende, i clienti e le tabelle di
 * fatturazione e legge lo stato finale. Pulizia solo per id esatti creati.
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
import { periodiDaFrequenza } from '../../domain/contratti-cliente/periodi-fatturazione'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { DittaPrismaRepository } from '../../infrastructure/persistence/ditta-prisma.repository'
import { creaDittaConRuolo, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { creaTabelleFatturazione } from '../../test-support/fatturazione-di-test'
import { DitteService } from '../registry/ditte/ditte.service'
import { ClientiService } from '../clienti/clienti.service'
import { ContrattiClienteService } from './contratti-cliente.service'

describe('ContrattiClienteService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: ContrattiClienteService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    const ditte = new DitteService(app, new DittaPrismaRepository())
    service = new ContrattiClienteService(app, new ClientiService(app, ditte))
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      // Le FK composite sono NoAction: prima le righe che citano, poi quelle citate.
      const in_ = { in: tenantCreati }
      await owner.allegatoContrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.periodoFatturazioneCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
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
        ragioneSociale: 'Contratti SRL',
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
    return { tenantId: t.id, utenteId: utente.id }
  }

  async function cliente(
    tenantId: string,
    extra: Record<string, unknown> = {},
    nome = `Cliente ${++n}`
  ) {
    const c = await creaDittaConRuolo(owner, tenantId, 'CLIENTE', { ragioneSociale: nome })
    if (Object.keys(extra).length > 0) {
      await owner.cliente.update({ where: { id: c.ruoloId }, data: extra })
    }
    return c
  }

  const numero = () => `CC-2026-${String(++n).padStart(3, '0')}`
  const dati = (clienteId: string, extra: Record<string, unknown> = {}) => ({
    numero: numero(),
    descrizione: 'Contratto di prova',
    clienteId,
    dataInizio: '2026-01-01',
    ...extra,
  })

  it('crea con frequenza trimestrale: 4 periodi in ordine 1..4', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await cliente(tenantId)
    const v = await nel(tenantId, () =>
      service.crea(
        tenantId,
        utenteId,
        dati(c.ruoloId, { periodi: periodiDaFrequenza('TRIMESTRALE') })
      )
    )
    expect(v.stato).toBe('BOZZA')
    expect(v.periodi).toHaveLength(4)
    const righe = await owner.periodoFatturazioneCliente.findMany({
      where: { contrattoId: v.id },
      orderBy: { ordine: 'asc' },
    })
    expect(righe.map(r => r.ordine)).toEqual([1, 2, 3, 4])
    expect(righe[0]).toMatchObject({ giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 })
  })

  it('crea senza condizione: predefinita dal cliente; conto non copiato ma effettivo', async () => {
    const { tenantId, utenteId } = await azienda()
    const t = await creaTabelleFatturazione(owner, tenantId)
    const c = await cliente(tenantId, {
      condizionePagamentoId: t.condizioneId,
      registroIvaId: t.registroId,
      contoCorrenteId: t.contoId,
      esigibilitaIva: 'DIFFERITA',
      ritenutaPercentuale: '4.5',
      codiceDestinatario: 'ABCDEFG',
    })
    const v = await nel(tenantId, () => service.crea(tenantId, utenteId, dati(c.ruoloId)))
    expect(v.condizionePagamento?.id).toBe(t.condizioneId)
    expect(v.registroIva?.id).toBe(t.registroId)
    expect(v.esigibilitaIva).toBe('DIFFERITA')
    expect(v.ritenutaPercentuale).toBe('4.50')
    expect(v.codiceDestinatario).toBe('ABCDEFG')
    expect(v.contoCorrenteId).toBeNull()
    expect(v.contoCorrente).toBeNull()
    expect(v.contoCorrenteEffettivo?.id).toBe(t.contoId)
    const log = await owner.activityLog.findFirst({
      where: { tenantId, action: 'CONTRATTO_CLIENTE_CREATO' },
    })
    expect(log?.metadata).toEqual({ contrattoId: v.id, numero: v.numero })
  })

  it('cliente di fatturazione diverso: codice destinatario e riferimento dal suo anagrafico (R35)', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await cliente(tenantId, { codiceDestinatario: 'ABCDEFG' })
    const f = await cliente(tenantId, {
      codiceDestinatario: 'UFE1AB',
      riferimentoAmministrazione: 'RIF-PA',
    })
    const v = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, dati(c.ruoloId, { clienteFatturazioneId: f.ruoloId }))
    )
    expect(v.codiceDestinatario).toBe('UFE1AB')
    expect(v.riferimentoAmministrazione).toBe('RIF-PA')
    expect(v.clienteFatturazione?.id).toBe(f.ruoloId)
  })

  it('predefinito del cliente disattivato: 400 dedicato; con null esplicito il contratto nasce (R42)', async () => {
    const { tenantId, utenteId } = await azienda()
    const t = await creaTabelleFatturazione(owner, tenantId)
    const c = await cliente(tenantId, { condizionePagamentoId: t.condizioneId })
    await owner.condizionePagamento.update({
      where: { id: t.condizioneId },
      data: { attiva: false },
    })
    await expect(
      nel(tenantId, () => service.crea(tenantId, utenteId, dati(c.ruoloId)))
    ).rejects.toMatchObject({
      status: 400,
      response: {
        message: [
          "La condizione di pagamento predefinita del cliente è disattivata: scegline un'altra o lascia il campo vuoto.",
        ],
      },
    })
    expect(await owner.contrattoCliente.count({ where: { tenantId } })).toBe(0)
    const v = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, dati(c.ruoloId, { condizionePagamentoId: null }))
    )
    expect(v.condizionePagamento).toBeNull()
  })

  it('riferimenti di B nel contesto di A: 400 e nessuna riga scritta', async () => {
    const a = await azienda()
    const b = await azienda()
    const tb = await creaTabelleFatturazione(owner, b.tenantId)
    const c = await cliente(a.tenantId)
    await expect(
      nel(a.tenantId, () =>
        service.crea(
          a.tenantId,
          a.utenteId,
          dati(c.ruoloId, { condizionePagamentoId: tb.condizioneId })
        )
      )
    ).rejects.toMatchObject({
      status: 400,
      response: { message: ['La condizione di pagamento scelta non esiste o è disattivata.'] },
    })
    expect(await owner.contrattoCliente.count({ where: { tenantId: a.tenantId } })).toBe(0)
    expect(await owner.periodoFatturazioneCliente.count({ where: { tenantId: a.tenantId } })).toBe(
      0
    )
  })

  it('cliente di B nel contesto di A: 400', async () => {
    const a = await azienda()
    const b = await azienda()
    const cb = await cliente(b.tenantId)
    await expect(
      nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati(cb.ruoloId)))
    ).rejects.toMatchObject({
      status: 400,
      response: { message: ['Il cliente scelto non esiste o è disattivato.'] },
    })
  })

  it('periodi non validi: 400 e nessuna riga scritta', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await cliente(tenantId)
    await expect(
      nel(tenantId, () =>
        service.crea(
          tenantId,
          utenteId,
          dati(c.ruoloId, {
            periodi: [
              { giornoInizio: 1, meseInizio: 1, giornoFine: 28, meseFine: 2 },
              { giornoInizio: 15, meseInizio: 2, giornoFine: 31, meseFine: 3 },
            ],
          })
        )
      )
    ).rejects.toMatchObject({ status: 400, response: { error: 'CONTRATTO_CLIENTE_NON_VALIDO' } })
    expect(await owner.contrattoCliente.count({ where: { tenantId } })).toBe(0)
    expect(await owner.periodoFatturazioneCliente.count({ where: { tenantId } })).toBe(0)
  })

  it('numero duplicato: 409 CONTRATTO_CLIENTE_NUMERO_DUPLICATO (ruolo applicativo, target nullo)', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await cliente(tenantId)
    const d = dati(c.ruoloId)
    await nel(tenantId, () => service.crea(tenantId, utenteId, d))
    await expect(nel(tenantId, () => service.crea(tenantId, utenteId, d))).rejects.toMatchObject({
      status: 409,
      response: { error: 'CONTRATTO_CLIENTE_NUMERO_DUPLICATO' },
    })
  })

  it('contratto allegato al principale dello stesso cliente: vista con contrattoPrincipale e allegati 1', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await cliente(tenantId)
    const principale = await nel(tenantId, () => service.crea(tenantId, utenteId, dati(c.ruoloId)))
    const allegato = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, dati(c.ruoloId, { contrattoPrincipaleId: principale.id }))
    )
    expect(allegato.contrattoPrincipale).toEqual({ id: principale.id, numero: principale.numero })
    const riletto = await nel(tenantId, () => service.getById(tenantId, principale.id))
    expect(riletto.allegati).toBe(1)
    expect(riletto.eliminabile).toBe(false)
  })

  it('principale di un altro cliente o già allegato: 400', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await cliente(tenantId)
    const altro = await cliente(tenantId)
    const principale = await nel(tenantId, () => service.crea(tenantId, utenteId, dati(c.ruoloId)))
    await expect(
      nel(tenantId, () =>
        service.crea(
          tenantId,
          utenteId,
          dati(altro.ruoloId, { contrattoPrincipaleId: principale.id })
        )
      )
    ).rejects.toMatchObject({ status: 400 })
    const figlio = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, dati(c.ruoloId, { contrattoPrincipaleId: principale.id }))
    )
    await expect(
      nel(tenantId, () =>
        service.crea(tenantId, utenteId, dati(c.ruoloId, { contrattoPrincipaleId: figlio.id }))
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('cliente disattivato in parallelo: il contratto non nasce (FOR SHARE sul cliente, R24)', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await cliente(tenantId)
    let crea: Promise<unknown> | undefined
    await owner.$transaction(
      async tx => {
        // la disattivazione tiene il lock sulla riga finche' la transazione non si chiude
        await tx.$executeRaw`UPDATE "clienti" SET attivo = false WHERE id = ${c.ruoloId}::uuid`
        crea = nel(tenantId, () => service.crea(tenantId, utenteId, dati(c.ruoloId))).catch(e => e)
        await new Promise(r => setTimeout(r, 700))
      },
      { timeout: 20000 }
    )
    const esito = (await crea) as { status?: number }
    expect(esito.status).toBe(400)
    expect(await owner.contrattoCliente.count({ where: { tenantId } })).toBe(0)
  })

  it('prossimoNumero conta anche gli eliminati', async () => {
    const { tenantId, utenteId } = await azienda()
    const c = await cliente(tenantId)
    const anno = new Date().getFullYear()
    const v = await nel(tenantId, () =>
      service.crea(tenantId, utenteId, { ...dati(c.ruoloId), numero: `CC-${anno}-005` })
    )
    await owner.contrattoCliente.update({
      where: { id: v.id },
      data: { eliminatoIl: new Date(), eliminatoDa: utenteId },
    })
    const prossimo = await nel(tenantId, () => service.prossimoNumero(tenantId))
    expect(prossimo).toMatch(/^CC-\d{4}-006$/)
  })

  it('paginazione e filtri', async () => {
    const { tenantId, utenteId } = await azienda()
    const t = await creaTabelleFatturazione(owner, tenantId)
    const c1 = await cliente(tenantId, {}, 'Alfa Rossi')
    const c2 = await cliente(tenantId, {}, 'Beta Bianchi')
    const crea = (clienteId: string, extra: Record<string, unknown> = {}) =>
      nel(tenantId, () => service.crea(tenantId, utenteId, dati(clienteId, extra)))
    const a = await crea(c1.ruoloId, { categoriaId: t.categoriaId, dataFine: '2099-01-01' })
    await crea(c1.ruoloId, { commessa: 'COMM-1' })
    await crea(c2.ruoloId)
    const eliminato = await crea(c2.ruoloId)
    await owner.contrattoCliente.update({
      where: { id: eliminato.id },
      data: { eliminatoIl: new Date(), eliminatoDa: utenteId },
    })
    const lista = (f: Record<string, unknown> = {}) =>
      nel(tenantId, () => service.list(tenantId, { pagina: 1, dimensione: 20, ...f }))

    expect((await lista()).totale).toBe(3)
    const pag = await nel(tenantId, () => service.list(tenantId, { pagina: 2, dimensione: 2 }))
    expect(pag.totale).toBe(3)
    expect(pag.elementi).toHaveLength(1)
    expect((await lista({ clienteId: c2.ruoloId })).totale).toBe(1)
    expect((await lista({ categoriaId: t.categoriaId })).elementi.map(e => e.id)).toEqual([a.id])
    expect((await lista({ testo: 'bianchi' })).totale).toBe(1)
    expect((await lista({ testo: 'comm-1' })).totale).toBe(1)
    expect((await lista({ stato: 'ATTIVO' })).totale).toBe(0)
    expect((await lista({ inScadenzaEntroGiorni: 30 })).totale).toBe(0)
    await owner.contrattoCliente.update({
      where: { id: a.id },
      data: { dataFine: new Date(Date.now() + 10 * 86400000) },
    })
    expect((await lista({ inScadenzaEntroGiorni: 30 })).elementi.map(e => e.id)).toEqual([a.id])
  })
})
