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
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaTabelleFatturazione } from '../../test-support/fatturazione-di-test'
import {
  creaAddebito,
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
} from '../../test-support/listino-di-test'
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
      await owner.contrattoCliente.updateMany({
        where: { tenantId: in_ },
        data: { contrattoPrincipaleId: null },
      })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      // Righe ed elenchi sono andati a cascata col contratto: ora si possono togliere gli archivi.
      await owner.addebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codificaAddebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codiceIva.deleteMany({ where: { tenantId: in_ } })
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
        partitaIva: partitaIvaUnica(),
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

  // ---------------------------------------------------------------------------------------------
  // Task 17: modifica, stato, eliminazione
  // ---------------------------------------------------------------------------------------------
  describe('modifica, stato ed eliminazione', () => {
    const trim = [
      { giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 },
      { giornoInizio: 1, meseInizio: 4, giornoFine: 30, meseFine: 6 },
    ]
    const sem = [{ giornoInizio: 1, meseInizio: 1, giornoFine: 30, meseFine: 6 }]

    /** Contratto in BOZZA pronto per l'attivazione (condizione e registro presenti). */
    async function pronto(extra: Record<string, unknown> = {}) {
      const a = await azienda()
      const t = await creaTabelleFatturazione(owner, a.tenantId)
      const c = await cliente(a.tenantId)
      const v = await nel(a.tenantId, () =>
        service.crea(
          a.tenantId,
          a.utenteId,
          dati(c.ruoloId, {
            condizionePagamentoId: t.condizioneId,
            registroIvaId: t.registroId,
            ...extra,
          })
        )
      )
      return { ...a, t, c, v }
    }

    it('due modifiche con la stessa versione: una riesce, l’altra 409 e i periodi sono quelli della prima', async () => {
      const { tenantId, utenteId, v } = await pronto()
      const esiti = await Promise.allSettled([
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, v.id, { periodi: trim, versione: 1 })
        ),
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, v.id, { periodi: sem, versione: 1 })
        ),
      ])
      const riusciti = esiti.filter(e => e.status === 'fulfilled')
      const falliti = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
      expect(riusciti).toHaveLength(1)
      expect(falliti).toHaveLength(1)
      expect(falliti[0].reason).toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO' },
      })
      const vincente = (riusciti[0] as PromiseFulfilledResult<{ periodi: unknown[] }>).value
      const righe = await owner.periodoFatturazioneCliente.findMany({
        where: { contrattoId: v.id },
        orderBy: { ordine: 'asc' },
      })
      expect(righe).toHaveLength(vincente.periodi.length)
      expect(righe.map(r => r.ordine)).toEqual(righe.map((_, i) => i + 1))
      expect((await owner.contrattoCliente.findUnique({ where: { id: v.id } }))?.versione).toBe(2)
    })

    it('modifica letta prima di una sospensione riceve 409', async () => {
      const { tenantId, utenteId, v } = await pronto()
      const att = await nel(tenantId, () =>
        service.cambiaStato(tenantId, utenteId, v.id, 'ATTIVO', 1)
      )
      await nel(tenantId, () =>
        service.cambiaStato(tenantId, utenteId, v.id, 'SOSPESO', att.versione)
      )
      await expect(
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, v.id, {
            descrizione: 'Tardiva',
            versione: att.versione,
          })
        )
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO' },
      })
    })

    it('modifica: scrive, versione + 1, audit senza testo libero; null svuota', async () => {
      const { tenantId, utenteId, v } = await pronto({ dataFine: '2026-12-31' })
      const m = await nel(tenantId, () =>
        service.modifica(tenantId, utenteId, v.id, {
          descrizione: 'Riservata XYZ',
          dataFine: null,
          periodi: trim,
          versione: 1,
        })
      )
      expect(m.versione).toBe(2)
      expect(m.dataFine).toBeNull()
      expect(m.descrizione).toBe('Riservata XYZ')
      expect(m.periodi).toHaveLength(2)
      const log = await owner.activityLog.findFirst({
        where: { tenantId, action: 'CONTRATTO_CLIENTE_MODIFICATO' },
      })
      expect(JSON.stringify(log?.metadata)).not.toContain('Riservata')
      expect((log?.metadata as { campi: string[] }).campi).toEqual([
        'descrizione',
        'dataFine',
        'periodi',
      ])
      // nessuna differenza: nessuna scrittura
      const n = await nel(tenantId, () =>
        service.modifica(tenantId, utenteId, v.id, { descrizione: 'Riservata XYZ', versione: 2 })
      )
      expect(n.versione).toBe(2)
    })

    it('cambio del cliente di fatturazione: il recapito SDI segue il nuovo intestatario; i valori del corpo vincono (R44)', async () => {
      const { tenantId, utenteId, v } = await pronto()
      const f = await cliente(tenantId, {
        codiceDestinatario: 'UFE1AB',
        riferimentoAmministrazione: 'RIF-PA',
      })
      const g = await cliente(tenantId, { codiceDestinatario: 'GGGGGGG' })
      const m = await nel(tenantId, () =>
        service.modifica(tenantId, utenteId, v.id, {
          clienteFatturazioneId: f.ruoloId,
          versione: 1,
        })
      )
      expect(m.codiceDestinatario).toBe('UFE1AB')
      expect(m.riferimentoAmministrazione).toBe('RIF-PA')
      // secondo cambio, ora su un contratto con un solo valore nel corpo: il codice scritto vince
      // e il riferimento del vecchio intestatario non resta (il nuovo non ne ha)
      const m2 = await nel(tenantId, () =>
        service.modifica(tenantId, utenteId, v.id, {
          clienteFatturazioneId: g.ruoloId,
          codiceDestinatario: 'MANUALE',
          versione: 2,
        })
      )
      expect(m2.codiceDestinatario).toBe('MANUALE')
      expect(m2.riferimentoAmministrazione).toBeNull()
      // fatturazione tolta: torna il recapito del cliente
      const m3 = await nel(tenantId, () =>
        service.modifica(tenantId, utenteId, v.id, {
          clienteFatturazioneId: null,
          versione: 3,
        })
      )
      expect(m3.clienteFatturazione).toBeNull()
      expect(m3.codiceDestinatario).toBe(v.codiceDestinatario)
    })

    it('bollo verso una spesa di incasso: 400; cliente di fatturazione disattivato: 400', async () => {
      const { tenantId, utenteId, v, t } = await pronto()
      await expect(
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, v.id, { bolloId: t.speseId, versione: 1 })
        )
      ).rejects.toMatchObject({ status: 400 })
      const f = await cliente(tenantId, { attivo: false })
      await expect(
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, v.id, {
            clienteFatturazioneId: f.ruoloId,
            versione: 1,
          })
        )
      ).rejects.toMatchObject({
        status: 400,
        response: { message: ['Il cliente di fatturazione scelto non esiste o è disattivato.'] },
      })
      expect((await owner.contrattoCliente.findUnique({ where: { id: v.id } }))?.versione).toBe(1)
    })

    it('ATTIVO → SOSPESO_MOVIMENTI → ATTIVO → ANNULLATO: versione 5, motivo salvato', async () => {
      const { tenantId, utenteId, v } = await pronto()
      const passo = (
        a: 'ATTIVO' | 'SOSPESO_MOVIMENTI' | 'ANNULLATO',
        ver: number,
        annullo?: object
      ) => nel(tenantId, () => service.cambiaStato(tenantId, utenteId, v.id, a, ver, annullo))
      const a1 = await passo('ATTIVO', 1)
      const a2 = await passo('SOSPESO_MOVIMENTI', a1.versione)
      const a3 = await passo('ATTIVO', a2.versione)
      const a4 = await passo('ANNULLATO', a3.versione, { motivo: 'Disdetta del cliente' })
      expect(a4.versione).toBe(5)
      expect(a4.stato).toBe('ANNULLATO')
      expect(a4.motivoAnnullo).toBe('Disdetta del cliente')
      expect(a4.annullatoIl).not.toBeNull()
      expect(a4.transizioni).toEqual([])
      const log = await owner.activityLog.findMany({
        where: { tenantId, action: 'CONTRATTO_CLIENTE_STATO' },
      })
      expect(log).toHaveLength(4)
      expect(JSON.stringify(log.map(l => l.metadata))).not.toContain('Disdetta')
    })

    it('BOZZA → ATTIVO senza condizione o registro: 400, resta in bozza', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const v = await nel(a.tenantId, () => service.crea(a.tenantId, a.utenteId, dati(c.ruoloId)))
      await expect(
        nel(a.tenantId, () => service.cambiaStato(a.tenantId, a.utenteId, v.id, 'ATTIVO', 1))
      ).rejects.toMatchObject({ status: 400 })
      expect((await owner.contrattoCliente.findUnique({ where: { id: v.id } }))?.stato).toBe(
        'BOZZA'
      )
    })

    it('annullo col solo codice: testo dalla codifica; codice disattivato: 400', async () => {
      const { tenantId, utenteId, v, t } = await pronto()
      const att = await nel(tenantId, () =>
        service.cambiaStato(tenantId, utenteId, v.id, 'ATTIVO', 1)
      )
      await owner.codificaContratto.update({ where: { id: t.motivoId }, data: { attiva: false } })
      await expect(
        nel(tenantId, () =>
          service.cambiaStato(tenantId, utenteId, v.id, 'ANNULLATO', att.versione, {
            motivoAnnulloId: t.motivoId,
          })
        )
      ).rejects.toMatchObject({
        status: 400,
        response: { message: ['Il motivo di annullo scelto non esiste o è disattivato.'] },
      })
      await owner.codificaContratto.update({ where: { id: t.motivoId }, data: { attiva: true } })
      const descrizione = (await owner.codificaContratto.findUnique({ where: { id: t.motivoId } }))!
        .descrizione
      const an = await nel(tenantId, () =>
        service.cambiaStato(tenantId, utenteId, v.id, 'ANNULLATO', att.versione, {
          motivoAnnulloId: t.motivoId,
        })
      )
      expect(an.motivoAnnullo).toBe(descrizione)
      expect(an.motivoAnnulloCodifica?.id).toBe(t.motivoId)
      const log = await owner.activityLog.findFirst({
        where: {
          tenantId,
          action: 'CONTRATTO_CLIENTE_STATO',
          description: { contains: 'Annullato' },
        },
      })
      expect(log?.metadata).toEqual({
        contrattoId: v.id,
        da: 'ATTIVO',
        a: 'ANNULLATO',
        motivoAnnulloId: t.motivoId,
      })
    })

    it('annullato non si modifica (409) e non cambia stato', async () => {
      const { tenantId, utenteId, v } = await pronto()
      const att = await nel(tenantId, () =>
        service.cambiaStato(tenantId, utenteId, v.id, 'ATTIVO', 1)
      )
      const an = await nel(tenantId, () =>
        service.cambiaStato(tenantId, utenteId, v.id, 'ANNULLATO', att.versione, { motivo: 'Fine' })
      )
      await expect(
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, v.id, { descrizione: 'Altro', versione: 1 })
        )
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_NON_MODIFICABILE' },
      })
      await expect(
        nel(tenantId, () => service.cambiaStato(tenantId, utenteId, v.id, 'ATTIVO', an.versione))
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_TRANSIZIONE_NON_AMMESSA' },
      })
      const riga = await owner.contrattoCliente.findUnique({ where: { id: v.id } })
      expect(riga?.stato).toBe('ANNULLATO')
      expect(riga?.versione).toBe(an.versione)
    })

    it('allegamenti concorrenti: nessuna catena (A→B e B→C in parallelo)', async () => {
      for (let giro = 0; giro < 3; giro++) {
        const { tenantId, utenteId } = await azienda()
        const c = await cliente(tenantId)
        const crea = () => nel(tenantId, () => service.crea(tenantId, utenteId, dati(c.ruoloId)))
        const [A, B, C] = [await crea(), await crea(), await crea()]
        const esiti = await Promise.allSettled([
          nel(tenantId, () =>
            service.modifica(tenantId, utenteId, A.id, { contrattoPrincipaleId: B.id, versione: 1 })
          ),
          nel(tenantId, () =>
            service.modifica(tenantId, utenteId, B.id, { contrattoPrincipaleId: C.id, versione: 1 })
          ),
        ])
        const falliti = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
        expect(falliti).toHaveLength(1)
        expect(falliti[0].reason).toMatchObject({ status: 400 })
        const righe = await owner.contrattoCliente.findMany({ where: { tenantId } })
        const principali = new Set(righe.map(r => r.contrattoPrincipaleId).filter(Boolean))
        const allegati = righe.filter(r => r.contrattoPrincipaleId !== null).map(r => r.id)
        expect(allegati.filter(id => principali.has(id))).toEqual([])
      }
    })

    it('principale di un altro cliente o annullato: 400; allegato staccato con null', async () => {
      const { tenantId, utenteId } = await azienda()
      const c = await cliente(tenantId)
      const altro = await cliente(tenantId)
      const crea = (cl: string) => nel(tenantId, () => service.crea(tenantId, utenteId, dati(cl)))
      const A = await crea(c.ruoloId)
      const B = await crea(c.ruoloId)
      const X = await crea(altro.ruoloId)
      await expect(
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, A.id, { contrattoPrincipaleId: X.id, versione: 1 })
        )
      ).rejects.toMatchObject({ status: 400 })
      const m = await nel(tenantId, () =>
        service.modifica(tenantId, utenteId, A.id, { contrattoPrincipaleId: B.id, versione: 1 })
      )
      expect(m.contrattoPrincipale?.id).toBe(B.id)
      // B ha un allegato: non si allega a un altro
      const C = await crea(c.ruoloId)
      await expect(
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, B.id, { contrattoPrincipaleId: C.id, versione: 1 })
        )
      ).rejects.toMatchObject({ status: 400 })
      const s = await nel(tenantId, () =>
        service.modifica(tenantId, utenteId, A.id, { contrattoPrincipaleId: null, versione: 2 })
      )
      expect(s.contrattoPrincipale).toBeNull()
    })

    describe('contratto allegato e righe di listino (4.2b, D17)', () => {
      const MSG_RIGHE_NON_T =
        'Questo contratto ha addebiti di tipo diverso da T: non può essere allegato a un altro.'

      /** Un principale e un contratto in BOZZA dello stesso cliente, con una riga del tipo dato. */
      async function scenario(riga: { tipo: string; addebitoTipo?: string } | null) {
        const a = await azienda()
        const c = await cliente(a.tenantId)
        const listino = await creaCodiciIvaEcodifiche(owner, a.tenantId)
        const principale = await creaContrattoConElenco(owner, a.tenantId, {
          clienteId: c.ruoloId,
          stato: 'BOZZA',
        })
        const figlio = await creaContrattoConElenco(owner, a.tenantId, {
          clienteId: c.ruoloId,
          stato: 'BOZZA',
        })
        if (riga) {
          const addebito = riga.addebitoTipo
            ? await creaAddebito(owner, a.tenantId, { tipo: riga.addebitoTipo })
            : undefined
          await creaRiga(owner, a.tenantId, figlio.elencoId, {
            tipo: riga.tipo,
            addebitoId: addebito?.id,
            codiceIvaId: listino.iva22Id,
          })
        }
        return { ...a, principale, figlio, listino }
      }

      const allega = (s: {
        tenantId: string
        utenteId: string
        principale: { contrattoId: string }
        figlio: { contrattoId: string }
      }) =>
        nel(s.tenantId, () =>
          service.modifica(s.tenantId, s.utenteId, s.figlio.contrattoId, {
            contrattoPrincipaleId: s.principale.contrattoId,
            versione: 1,
          })
        )

      it('con una riga V: non si allega, 400, il contratto resta com’è', async () => {
        const s = await scenario({ tipo: 'V' })
        await expect(allega(s)).rejects.toMatchObject({
          status: 400,
          response: { message: [MSG_RIGHE_NON_T] },
        })
        const dopo = await owner.contrattoCliente.findUniqueOrThrow({
          where: { id: s.figlio.contrattoId },
        })
        expect(dopo.contrattoPrincipaleId).toBeNull()
        expect(dopo.versione).toBe(1)
      })

      it('con una riga CER: non si allega, 400', async () => {
        const s = await scenario({ tipo: 'CER' })
        await expect(allega(s)).rejects.toMatchObject({
          status: 400,
          response: { message: [MSG_RIGHE_NON_T] },
        })
      })

      it('con sole righe TT: si allega', async () => {
        const s = await scenario({ tipo: 'TT', addebitoTipo: 'TT' })
        const v = await allega(s)
        expect(v.contrattoPrincipale?.id).toBe(s.principale.contrattoId)
      })

      it('senza righe: si allega; con una riga V si stacca comunque (null)', async () => {
        const s = await scenario(null)
        await allega(s)
        const v = await nel(s.tenantId, () =>
          service.modifica(s.tenantId, s.utenteId, s.figlio.contrattoId, {
            contrattoPrincipaleId: null,
            versione: 2,
          })
        )
        expect(v.contrattoPrincipale).toBeNull()
      })

      it('allegamento e riga CER concorrenti: mai un allegato con righe CER', async () => {
        const s = await scenario(null)
        // Il "scrittore di righe" legge il contratto FOR SHARE (come RigheAddebitoService), aspetta
        // e inserisce una riga CER: l'allegamento chiede FOR UPDATE e deve mettersi in fila.
        const scrittore = owner.$transaction(
          async tx => {
            await tx.$queryRaw`SELECT id FROM contratti_cliente
              WHERE id = ${s.figlio.contrattoId}::uuid FOR SHARE`
            await tx.$executeRaw`SELECT pg_sleep(1.2)`
            await tx.rigaAddebito.create({
              data: {
                tenantId: s.tenantId,
                elencoId: s.figlio.elencoId,
                tipo: 'CER',
                cerCode: '20 03 01',
                tipoQuantita: 'PESO_NETTO',
                unitaMisura: 'KG',
                prezzo: '1',
                codiceIvaId: s.listino.iva22Id,
              },
            })
          },
          { timeout: 15000 }
        )
        await new Promise(r => setTimeout(r, 300))
        const avvio = Date.now()
        const esiti = await Promise.allSettled([scrittore, allega(s)])
        expect(esiti[0].status).toBe('fulfilled')
        expect(esiti[1]).toMatchObject({ status: 'rejected', reason: { status: 400 } })
        // L'allegamento ha aspettato lo scrittore (non e' passato prima del suo commit).
        expect(Date.now() - avvio).toBeGreaterThan(600)
        const dopo = await owner.contrattoCliente.findUniqueOrThrow({
          where: { id: s.figlio.contrattoId },
        })
        expect(dopo.contrattoPrincipaleId).toBeNull()
        expect(
          await owner.rigaAddebito.count({
            where: { tenantId: s.tenantId, elencoId: s.figlio.elencoId, tipo: 'CER' },
          })
        ).toBe(1)
      })
    })

    it('numero duplicato in modifica: 409 CONTRATTO_CLIENTE_NUMERO_DUPLICATO', async () => {
      const { tenantId, utenteId, c, v } = await pronto()
      const altro = await nel(tenantId, () => service.crea(tenantId, utenteId, dati(c.ruoloId)))
      await expect(
        nel(tenantId, () =>
          service.modifica(tenantId, utenteId, v.id, { numero: altro.numero, versione: 1 })
        )
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_NUMERO_DUPLICATO' },
      })
    })

    it('eliminato: sparisce da list, getById 404, modifica 404, cambiaStato 404; la riga resta', async () => {
      const { tenantId, utenteId, v } = await pronto()
      await nel(tenantId, () => service.elimina(tenantId, utenteId, v.id, 1))
      expect(
        (await nel(tenantId, () => service.list(tenantId, { pagina: 1, dimensione: 20 }))).totale
      ).toBe(0)
      for (const op of <Array<() => Promise<unknown>>>[
        () => service.getById(tenantId, v.id),
        () => service.modifica(tenantId, utenteId, v.id, { descrizione: 'X', versione: 2 }),
        () => service.cambiaStato(tenantId, utenteId, v.id, 'ATTIVO', 2),
        () => service.elimina(tenantId, utenteId, v.id, 2),
      ]) {
        await expect(nel(tenantId, op)).rejects.toMatchObject({ status: 404 })
      }
      const riga = await owner.contrattoCliente.findUnique({ where: { id: v.id } })
      expect(riga?.eliminatoIl).not.toBeNull()
      expect(riga?.eliminatoDa).toBe(utenteId)
      expect(riga?.versione).toBe(2)
    })

    it('elimina fuori da BOZZA: 409; con allegati: 409 e la riga resta; versione vecchia: 409', async () => {
      const { tenantId, utenteId, c, v } = await pronto()
      const figlio = await nel(tenantId, () =>
        service.crea(tenantId, utenteId, dati(c.ruoloId, { contrattoPrincipaleId: v.id }))
      )
      await expect(
        nel(tenantId, () => service.elimina(tenantId, utenteId, v.id, 1))
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_CON_ALLEGATI' },
      })
      await expect(
        nel(tenantId, () => service.elimina(tenantId, utenteId, v.id, 9))
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO' },
      })
      await nel(tenantId, () => service.elimina(tenantId, utenteId, figlio.id, 1))
      await nel(tenantId, () => service.cambiaStato(tenantId, utenteId, v.id, 'ATTIVO', 1))
      await expect(
        nel(tenantId, () => service.elimina(tenantId, utenteId, v.id, 2))
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_NON_ELIMINABILE' },
      })
    })

    it('nel contesto di B: 404 su tutto', async () => {
      const { v } = await pronto()
      const b = await azienda()
      for (const op of <Array<() => Promise<unknown>>>[
        () => service.getById(b.tenantId, v.id),
        () => service.modifica(b.tenantId, b.utenteId, v.id, { descrizione: 'X', versione: 1 }),
        () => service.cambiaStato(b.tenantId, b.utenteId, v.id, 'ATTIVO', 1),
        () => service.elimina(b.tenantId, b.utenteId, v.id, 1),
      ]) {
        await expect(nel(b.tenantId, op)).rejects.toMatchObject({ status: 404 })
      }
    })
  })

  // ---------------------------------------------------------------------------------------------
  // Task 18: rinnovo e proroga delle scadenze
  // ---------------------------------------------------------------------------------------------
  describe('rinnovo e proroga', () => {
    const giorno = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null

    /** Contratto creato dal servizio e portato dal proprietario allo stato/data voluti. */
    async function contratto(
      a: { tenantId: string; utenteId: string },
      clienteId: string,
      db: Record<string, unknown> = {}
    ) {
      const v = await nel(a.tenantId, () =>
        service.crea(a.tenantId, a.utenteId, dati(clienteId, { dataInizio: '2020-01-01' }))
      )
      const aggiornamento = {
        stato: 'ATTIVO',
        dataFine: new Date('2026-06-30T00:00:00.000Z'),
        rinnovoAutomatico: true,
        ...db,
      }
      await owner.contrattoCliente.update({ where: { id: v.id }, data: aggiornamento as never })
      return v.id
    }
    const leggi = (id: string) => owner.contrattoCliente.findUniqueOrThrow({ where: { id } })
    const proroga = (a: { tenantId: string; utenteId: string }, f: Record<string, unknown> = {}) =>
      nel(a.tenantId, () =>
        service.prorogaScadenze(a.tenantId, a.utenteId, {
          scadutiEntro: '2026-12-31',
          soloRinnovoAutomatico: true,
          ancheSospesi: false,
          ...f,
        })
      )

    it('rinnova: 29/02/2024 diventa 28/02/2025, versione + 1, audit con prima e dopo', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const id = await contratto(a, c.ruoloId, { dataFine: new Date('2024-02-29T00:00:00.000Z') })
      const prima = await leggi(id)
      const v = await nel(a.tenantId, () =>
        service.rinnova(a.tenantId, a.utenteId, id, prima.versione)
      )
      expect(v.dataFine).toBe('2025-02-28')
      expect(v.versione).toBe(prima.versione + 1)
      const log = await owner.activityLog.findFirst({
        where: { tenantId: a.tenantId, action: 'CONTRATTO_CLIENTE_RINNOVATO' },
      })
      expect(log?.metadata).toMatchObject({
        contrattoId: id,
        dataFinePrima: '2024-02-29',
        dataFineDopo: '2025-02-28',
      })
    })

    it('rinnova una bozza o un annullato: 409 NON_RINNOVABILE, la data non cambia', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const bozza = await contratto(a, c.ruoloId, { stato: 'BOZZA' })
      const annullato = await contratto(a, c.ruoloId, {
        stato: 'ANNULLATO',
        motivoAnnullo: 'Disdetta',
        annullatoIl: new Date(),
      })
      for (const id of [bozza, annullato]) {
        await expect(
          nel(a.tenantId, () => service.rinnova(a.tenantId, a.utenteId, id, 1))
        ).rejects.toMatchObject({
          status: 409,
          response: { error: 'CONTRATTO_CLIENTE_NON_RINNOVABILE' },
        })
        expect(giorno((await leggi(id)).dataFine)).toBe('2026-06-30')
      }
    })

    it('rinnova concorrente con una modifica: una riesce, l’altra 409', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const id = await contratto(a, c.ruoloId)
      const { versione } = await leggi(id)
      const esiti = await Promise.allSettled([
        nel(a.tenantId, () => service.rinnova(a.tenantId, a.utenteId, id, versione)),
        nel(a.tenantId, () =>
          service.modifica(a.tenantId, a.utenteId, id, { descrizione: 'Nuova', versione })
        ),
      ])
      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      const rifiutata = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutata.reason).toMatchObject({
        status: 409,
        response: { error: 'CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO' },
      })
      expect((await leggi(id)).versione).toBe(versione + 1)
    })

    it('proroga: 29/02/2024 diventa 28/02/2025, versione + 1, un solo audit', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const id = await contratto(a, c.ruoloId, { dataFine: new Date('2024-02-29T00:00:00.000Z') })
      const prima = await leggi(id)
      expect(await proroga(a)).toEqual({ prorogati: 1 })
      const dopo = await leggi(id)
      expect(giorno(dopo.dataFine)).toBe('2025-02-28')
      expect(dopo.versione).toBe(prima.versione + 1)
      expect(dopo.updatedAt.getTime()).toBeGreaterThan(prima.updatedAt.getTime())
      const log = await owner.activityLog.findMany({
        where: { tenantId: a.tenantId, action: 'CONTRATTO_CLIENTE_PROROGATI' },
      })
      expect(log).toHaveLength(1)
      expect(log[0].metadata).toMatchObject({
        prorogati: 1,
        filtri: { scadutiEntro: '2026-12-31', soloRinnovoAutomatico: true, ancheSospesi: false },
      })
    })

    it('proroga: solo i contratti con fine entro la data (inclusa) e con una data di fine', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const entro = await contratto(a, c.ruoloId, { dataFine: new Date('2026-12-31') })
      const oltre = await contratto(a, c.ruoloId, { dataFine: new Date('2027-01-01') })
      const senza = await contratto(a, c.ruoloId, { dataFine: null })
      expect(await proroga(a)).toEqual({ prorogati: 1 })
      expect(giorno((await leggi(entro)).dataFine)).toBe('2027-12-31')
      expect(giorno((await leggi(oltre)).dataFine)).toBe('2027-01-01')
      expect((await leggi(senza)).dataFine).toBeNull()
    })

    it('sospesi esclusi senza ancheSospesi, inclusi con', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const attivo = await contratto(a, c.ruoloId)
      const sospeso = await contratto(a, c.ruoloId, { stato: 'SOSPESO' })
      const soloMovimenti = await contratto(a, c.ruoloId, { stato: 'SOSPESO_MOVIMENTI' })
      expect(await proroga(a)).toEqual({ prorogati: 1 })
      expect(giorno((await leggi(attivo)).dataFine)).toBe('2027-06-30')
      expect(giorno((await leggi(sospeso)).dataFine)).toBe('2026-06-30')
      expect(giorno((await leggi(soloMovimenti)).dataFine)).toBe('2026-06-30')
      expect(await proroga(a, { ancheSospesi: true })).toEqual({ prorogati: 2 })
      expect(giorno((await leggi(sospeso)).dataFine)).toBe('2027-06-30')
      expect(giorno((await leggi(soloMovimenti)).dataFine)).toBe('2027-06-30')
      // l'attivo, ora al 2027-06-30, e' oltre la data: non si muove di nuovo
      expect(giorno((await leggi(attivo)).dataFine)).toBe('2027-06-30')
    })

    it('solo rinnovo automatico per default; senza il filtro anche gli altri', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const auto = await contratto(a, c.ruoloId)
      const manuale = await contratto(a, c.ruoloId, { rinnovoAutomatico: false })
      expect(await proroga(a)).toEqual({ prorogati: 1 })
      expect(giorno((await leggi(auto)).dataFine)).toBe('2027-06-30')
      expect(giorno((await leggi(manuale)).dataFine)).toBe('2026-06-30')
      expect(await proroga(a, { soloRinnovoAutomatico: false })).toEqual({ prorogati: 1 })
      expect(giorno((await leggi(manuale)).dataFine)).toBe('2027-06-30')
    })

    it('solo la categoria indicata; solo il cliente indicato', async () => {
      const a = await azienda()
      const t = await creaTabelleFatturazione(owner, a.tenantId)
      const c1 = await cliente(a.tenantId)
      const c2 = await cliente(a.tenantId)
      const conCategoria = await contratto(a, c1.ruoloId, { categoriaId: t.categoriaId })
      const senzaCategoria = await contratto(a, c1.ruoloId)
      const altroCliente = await contratto(a, c2.ruoloId, { categoriaId: t.categoriaId })
      expect(await proroga(a, { categoriaId: t.categoriaId, clienteId: c1.ruoloId })).toEqual({
        prorogati: 1,
      })
      expect(giorno((await leggi(conCategoria)).dataFine)).toBe('2027-06-30')
      expect(giorno((await leggi(senzaCategoria)).dataFine)).toBe('2026-06-30')
      expect(giorno((await leggi(altroCliente)).dataFine)).toBe('2026-06-30')
      expect(await proroga(a, { categoriaId: t.categoriaId })).toEqual({ prorogati: 1 })
      expect(giorno((await leggi(altroCliente)).dataFine)).toBe('2027-06-30')
    })

    it('bozze, annullati ed eliminati non si prorogano mai', async () => {
      const a = await azienda()
      const c = await cliente(a.tenantId)
      const bozza = await contratto(a, c.ruoloId, { stato: 'BOZZA' })
      const annullato = await contratto(a, c.ruoloId, {
        stato: 'ANNULLATO',
        motivoAnnullo: 'Disdetta',
        annullatoIl: new Date(),
      })
      const eliminato = await contratto(a, c.ruoloId, {
        eliminatoIl: new Date(),
        eliminatoDa: a.utenteId,
      })
      const versioni = await Promise.all([bozza, annullato, eliminato].map(i => leggi(i)))
      expect(await proroga(a, { ancheSospesi: true, soloRinnovoAutomatico: false })).toEqual({
        prorogati: 0,
      })
      for (const [k, id] of [bozza, annullato, eliminato].entries()) {
        const r = await leggi(id)
        expect(giorno(r.dataFine)).toBe('2026-06-30')
        expect(r.versione).toBe(versioni[k].versione)
      }
      // zero prorogati: nessun audit
      expect(
        await owner.activityLog.count({
          where: { tenantId: a.tenantId, action: 'CONTRATTO_CLIENTE_PROROGATI' },
        })
      ).toBe(0)
    })

    it('i contratti di B non si toccano', async () => {
      const a = await azienda()
      const b = await azienda()
      const ca = await cliente(a.tenantId)
      const cb = await cliente(b.tenantId)
      const ida = await contratto(a, ca.ruoloId)
      const idb = await contratto(b, cb.ruoloId)
      const versioneB = (await leggi(idb)).versione
      expect(await proroga(a)).toEqual({ prorogati: 1 })
      const rb = await leggi(idb)
      expect(giorno(rb.dataFine)).toBe('2026-06-30')
      expect(rb.versione).toBe(versioneB)
      expect(giorno((await leggi(ida)).dataFine)).toBe('2027-06-30')
      expect(
        await owner.activityLog.count({
          where: { tenantId: b.tenantId, action: 'CONTRATTO_CLIENTE_PROROGATI' },
        })
      ).toBe(0)
    })

    it('categoria di B nel filtro di A: nessun contratto toccato', async () => {
      const a = await azienda()
      const b = await azienda()
      const tb = await creaTabelleFatturazione(owner, b.tenantId)
      const ca = await cliente(a.tenantId)
      const id = await contratto(a, ca.ruoloId)
      expect(await proroga(a, { categoriaId: tb.categoriaId })).toEqual({ prorogati: 0 })
      expect(giorno((await leggi(id)).dataFine)).toBe('2026-06-30')
    })
  })
})
