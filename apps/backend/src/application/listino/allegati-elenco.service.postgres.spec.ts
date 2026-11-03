/**
 * Allegati PDF dell'elenco (4.2b, Task 25) contro un Postgres reale, collegato COME `wasteflow_app`,
 * dentro il `TenantContext`. Il proprietario prepara aziende, contratti ed elenchi e legge lo stato
 * finale. Pulizia solo per id esatti creati. Niente file su disco: i PDF stanno nel database.
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
// Le barriere su pg_stat_activity guardano solo le connessioni del servizio di questo processo.
const NOME_APPLICAZIONE = `allegati-elenco-t25-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { createHash } from 'crypto'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaContrattoConElenco } from '../../test-support/listino-di-test'
import { AllegatiElencoService } from './allegati-elenco.service'
import { ElenchiAddebitiService } from './elenchi-addebiti.service'

const pdf = (testo: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(testo)])
const file = (testo = 'uno', nome = 'elenco.pdf') => {
  const buffer = pdf(testo)
  return { originalname: nome, size: buffer.length, buffer }
}

describe('AllegatiElencoService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: AllegatiElencoService
  let elenchi: ElenchiAddebitiService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new AllegatiElencoService(app)
    elenchi = new ElenchiAddebitiService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      // Allegati, elenchi e righe vanno a cascata col contratto.
      await owner.contrattoCliente.updateMany({
        where: { tenantId: in_ },
        data: { contrattoPrincipaleId: null },
      })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.activityLog.deleteMany({ where: { tenantId: in_ } })
      await owner.user.deleteMany({ where: { tenantId: in_ } })
      await owner.tenant.deleteMany({ where: { id: in_ } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function conElenco(opzioni: Parameters<typeof creaContrattoConElenco>[2] = {}) {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Allegati elenco SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-allegati-elenco-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `allegati-elenco-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const c = await creaContrattoConElenco(owner, t.id, opzioni)
    return { tenantId: t.id, utenteId: utente.id, ...c }
  }

  it('carica, elenca, scarica (stessi byte) e rimuove; audit senza nome del file', async () => {
    const { tenantId, utenteId, elencoId } = await conElenco()
    const f2 = file('secondo', 'due.pdf')
    const v2 = await nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 2, f2))
    const v1 = await nel(tenantId, () =>
      service.carica(tenantId, utenteId, elencoId, 1, file('primo', '../../uno.pdf'))
    )
    expect(v1).toMatchObject({ posizione: 1, nomeFile: 'uno.pdf' })

    const riga = await owner.allegatoElencoAddebiti.findUniqueOrThrow({ where: { id: v2.id } })
    expect(riga.sha256).toBe(createHash('sha256').update(f2.buffer).digest('hex'))
    expect(riga.mimeType).toBe('application/pdf')
    expect(riga.caricatoDa).toBe(utenteId)

    const lista = await nel(tenantId, () => service.elenco(tenantId, elencoId))
    expect(lista.map(a => a.posizione)).toEqual([1, 2])
    expect(JSON.stringify(lista)).not.toContain('contenuto')

    const scaricato = await nel(tenantId, () => service.contenuto(tenantId, elencoId, v2.id))
    expect(scaricato.nomeFile).toBe('due.pdf')
    expect(scaricato.contenuto.equals(f2.buffer)).toBe(true)

    await nel(tenantId, () => service.rimuovi(tenantId, utenteId, elencoId, v2.id))
    expect(await owner.allegatoElencoAddebiti.count({ where: { elencoId } })).toBe(1)

    const log = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'ALLEGATO_ELENCO_ADDEBITI_' } },
    })
    expect(log.map(l => l.action).sort()).toEqual([
      'ALLEGATO_ELENCO_ADDEBITI_CARICATO',
      'ALLEGATO_ELENCO_ADDEBITI_CARICATO',
      'ALLEGATO_ELENCO_ADDEBITI_RIMOSSO',
    ])
    expect(JSON.stringify(log.map(l => l.metadata))).not.toContain('.pdf')
  })

  it('la versione dell’elenco non cambia con gli allegati', async () => {
    const { tenantId, utenteId, elencoId } = await conElenco()
    const prima = await owner.elencoAddebiti.findUniqueOrThrow({ where: { id: elencoId } })
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file()))
    await nel(tenantId, () => service.rimuovi(tenantId, utenteId, elencoId, v.id))
    const dopo = await owner.elencoAddebiti.findUniqueOrThrow({ where: { id: elencoId } })
    expect(dopo.versione).toBe(prima.versione)
  })

  it('contratto ANNULLATO: caricamento, lettura e rimozione ammessi (eccezione a D16)', async () => {
    const { tenantId, utenteId, elencoId } = await conElenco({ stato: 'ANNULLATO' })
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file()))
    expect(v.posizione).toBe(1)
    expect(await nel(tenantId, () => service.elenco(tenantId, elencoId))).toHaveLength(1)
    await nel(tenantId, () => service.rimuovi(tenantId, utenteId, elencoId, v.id))
    expect(await owner.allegatoElencoAddebiti.count({ where: { elencoId } })).toBe(0)
    // Il resto del listino resta in sola lettura: l'elenco si legge ancora con modificabile=false.
    const e = await nel(tenantId, () => elenchi.getById(tenantId, elencoId))
    expect(e.modificabile).toBe(false)
  })

  it('contratto eliminato o elenco inesistente: 404 su tutte e quattro le operazioni', async () => {
    const { tenantId, utenteId, contrattoId, elencoId } = await conElenco()
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file()))
    await owner.contrattoCliente.update({
      where: { id: contrattoId },
      data: { eliminatoIl: new Date() },
    })
    const audit = () =>
      owner.activityLog.count({
        where: { tenantId, action: { startsWith: 'ALLEGATO_ELENCO_ADDEBITI_' } },
      })
    const prima = await audit()
    await expect(
      nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 2, file()))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(nel(tenantId, () => service.elenco(tenantId, elencoId))).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(
      nel(tenantId, () => service.contenuto(tenantId, elencoId, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      nel(tenantId, () => service.rimuovi(tenantId, utenteId, elencoId, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(await owner.allegatoElencoAddebiti.count({ where: { elencoId } })).toBe(1)
    expect(await audit()).toBe(prima)
    await expect(
      nel(tenantId, () =>
        service.carica(tenantId, utenteId, '00000000-0000-4000-8000-000000000000', 1, file())
      )
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it("nel contesto di B l'elenco e l'allegato di A: 404", async () => {
    const a = await conElenco()
    const b = await conElenco()
    const v = await nel(a.tenantId, () =>
      service.carica(a.tenantId, a.utenteId, a.elencoId, 1, file())
    )
    await expect(
      nel(b.tenantId, () => service.carica(b.tenantId, b.utenteId, a.elencoId, 2, file()))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      nel(b.tenantId, () => service.elenco(b.tenantId, a.elencoId))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      nel(b.tenantId, () => service.contenuto(b.tenantId, a.elencoId, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      nel(b.tenantId, () => service.rimuovi(b.tenantId, b.utenteId, a.elencoId, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(await owner.allegatoElencoAddebiti.count({ where: { id: v.id } })).toBe(1)
  })

  it('allegato richiesto con l’elenco sbagliato (stessa azienda): 404', async () => {
    const { tenantId, utenteId, contrattoId, elencoId } = await conElenco()
    const altro = await owner.elencoAddebiti.create({
      data: { tenantId, contrattoId, codice: '002', descrizione: 'Secondo' },
    })
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file()))
    await expect(
      nel(tenantId, () => service.contenuto(tenantId, altro.id, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      nel(tenantId, () => service.rimuovi(tenantId, utenteId, altro.id, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('due caricamenti nella stessa posizione in parallelo: uno solo riesce, l’altro 409', async () => {
    const { tenantId, utenteId, elencoId } = await conElenco()
    // Barriera: una transazione del proprietario tiene l'elenco FOR UPDATE, quindi entrambi i
    // caricamenti (che lo chiedono FOR SHARE) restano fermi su un lock. Si rilascia solo quando
    // il database mostra DUE sessioni in attesa: la sovrapposizione e' provata, non supposta (M2).
    let rilascia!: () => void
    const barriera = new Promise<void>(r => (rilascia = r))
    let tenuto!: () => void
    const eTenuto = new Promise<void>(r => (tenuto = r))
    const tenitore = owner.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "elenchi_addebiti" WHERE id = ${elencoId}::uuid FOR UPDATE`
        tenuto()
        await barriera
      },
      { timeout: 60_000 }
    )
    await eTenuto
    const caricamenti = [
      nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file('a'))),
      nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file('b'))),
    ]
    const scadenza = Date.now() + 30_000
    let inAttesa = 0
    while (inAttesa < 2 && Date.now() < scadenza) {
      const [r] = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()
          AND application_name = ${NOME_APPLICAZIONE}`
      inAttesa = r.n
      if (inAttesa < 2) await new Promise(res => setTimeout(res, 25))
    }
    rilascia()
    await tenitore
    expect(inAttesa).toBe(2)
    const esiti = await Promise.allSettled(caricamenti)
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const rifiuto = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
    expect(rifiuto.reason).toBeInstanceOf(ConflictException)
    expect(rifiuto.reason.getResponse()).toMatchObject({ error: 'ALLEGATO_POSIZIONE_OCCUPATA' })
    expect(await owner.allegatoElencoAddebiti.count({ where: { elencoId } })).toBe(1)
    expect(
      await owner.activityLog.count({
        where: { tenantId, action: 'ALLEGATO_ELENCO_ADDEBITI_CARICATO' },
      })
    ).toBe(1)
  })

  it('posizione occupata in sequenza: 409; dopo la rimozione si ricarica', async () => {
    const { tenantId, utenteId, elencoId } = await conElenco()
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file()))
    await expect(
      nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file('altro')))
    ).rejects.toBeInstanceOf(ConflictException)
    await nel(tenantId, () => service.rimuovi(tenantId, utenteId, elencoId, v.id))
    await expect(
      nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file('altro')))
    ).resolves.toMatchObject({ posizione: 1 })
  })

  it('file non PDF o oltre 4 MiB: nessuna riga', async () => {
    const { tenantId, utenteId, elencoId } = await conElenco()
    const exe = Buffer.from('MZ finto eseguibile')
    await expect(
      nel(tenantId, () =>
        service.carica(tenantId, utenteId, elencoId, 1, {
          originalname: 'x.pdf',
          size: exe.length,
          buffer: exe,
        })
      )
    ).rejects.toMatchObject({ status: 415 })
    const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(4 * 1024 * 1024)])
    await expect(
      nel(tenantId, () =>
        service.carica(tenantId, utenteId, elencoId, 2, {
          originalname: 'g.pdf',
          size: grande.length,
          buffer: grande,
        })
      )
    ).rejects.toMatchObject({ status: 413 })
    expect(await owner.allegatoElencoAddebiti.count({ where: { tenantId } })).toBe(0)
  })

  it('l’eliminazione dell’elenco porta via gli allegati (cascata)', async () => {
    const { tenantId, utenteId, elencoId } = await conElenco()
    await nel(tenantId, () => service.carica(tenantId, utenteId, elencoId, 1, file()))
    const e = await owner.elencoAddebiti.findUniqueOrThrow({ where: { id: elencoId } })
    await nel(tenantId, () => elenchi.elimina(tenantId, utenteId, elencoId, e.versione))
    expect(await owner.allegatoElencoAddebiti.count({ where: { elencoId } })).toBe(0)
  })
})
