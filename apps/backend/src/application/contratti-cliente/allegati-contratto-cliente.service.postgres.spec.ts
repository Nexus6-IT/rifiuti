/**
 * Allegati PDF del contratto cliente (4.1b, Task 19) contro un Postgres reale, collegato COME
 * `wasteflow_app`, dentro il `TenantContext`. Il proprietario prepara aziende, clienti e contratti
 * e legge lo stato finale. Pulizia solo per id esatti creati.
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

import { createHash } from 'crypto'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { AllegatiContrattoClienteService } from './allegati-contratto-cliente.service'

const pdf = (testo: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(testo)])
const file = (testo = 'uno', nome = 'contratto.pdf') => {
  const buffer = pdf(testo)
  return { originalname: nome, size: buffer.length, buffer }
}

describe('AllegatiContrattoClienteService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: AllegatiContrattoClienteService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new AllegatiContrattoClienteService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
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
        ragioneSociale: 'Allegati SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-allegati-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `allegati-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const c = await creaDittaConRuolo(owner, t.id, 'CLIENTE', { ragioneSociale: `Cliente ${n}` })
    return { tenantId: t.id, utenteId: utente.id, clienteId: c.ruoloId }
  }

  async function contratto(
    tenantId: string,
    clienteId: string,
    extra: Record<string, unknown> = {}
  ) {
    return owner.contrattoCliente.create({
      data: {
        tenantId,
        clienteId,
        numero: `CC-2026-${String(++n).padStart(3, '0')}`,
        descrizione: 'Contratto di prova',
        dataInizio: new Date('2026-01-01T00:00:00.000Z'),
        ...extra,
      },
    })
  }

  it('carica, elenca, scarica (stessi byte) e rimuove; audit senza nome del file', async () => {
    const { tenantId, utenteId, clienteId } = await azienda()
    const k = await contratto(tenantId, clienteId)
    const f2 = file('secondo', 'due.pdf')
    const v2 = await nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 2, f2))
    const v1 = await nel(tenantId, () =>
      service.carica(tenantId, utenteId, k.id, 1, file('primo', '../../uno.pdf'))
    )
    expect(v1).toMatchObject({ posizione: 1, nomeFile: 'uno.pdf' })

    const riga = await owner.allegatoContrattoCliente.findUniqueOrThrow({ where: { id: v2.id } })
    expect(riga.sha256).toBe(createHash('sha256').update(f2.buffer).digest('hex'))
    expect(riga.mimeType).toBe('application/pdf')
    expect(riga.caricatoDa).toBe(utenteId)

    const elenco = await nel(tenantId, () => service.elenco(tenantId, k.id))
    expect(elenco.map(a => a.posizione)).toEqual([1, 2])
    expect(JSON.stringify(elenco)).not.toContain('contenuto')

    const scaricato = await nel(tenantId, () => service.contenuto(tenantId, k.id, v2.id))
    expect(scaricato.nomeFile).toBe('due.pdf')
    expect(scaricato.contenuto.equals(f2.buffer)).toBe(true)

    await nel(tenantId, () => service.rimuovi(tenantId, utenteId, k.id, v2.id))
    expect(await owner.allegatoContrattoCliente.count({ where: { contrattoId: k.id } })).toBe(1)

    const log = await owner.activityLog.findMany({
      where: { tenantId, action: { startsWith: 'ALLEGATO_CONTRATTO_CLIENTE_' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(log.map(l => l.action).sort()).toEqual([
      'ALLEGATO_CONTRATTO_CLIENTE_CARICATO',
      'ALLEGATO_CONTRATTO_CLIENTE_CARICATO',
      'ALLEGATO_CONTRATTO_CLIENTE_RIMOSSO',
    ])
    expect(JSON.stringify(log.map(l => l.metadata))).not.toContain('.pdf')
  })

  it('allegato di un contratto annullato: ammesso', async () => {
    const { tenantId, utenteId, clienteId } = await azienda()
    const k = await contratto(tenantId, clienteId, {
      stato: 'ANNULLATO',
      motivoAnnullo: 'Cliente cessato',
      annullatoIl: new Date(),
    })
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 1, file()))
    expect(v.posizione).toBe(1)
  })

  it('contratto eliminato o inesistente: 404 su tutte e quattro le operazioni', async () => {
    const { tenantId, utenteId, clienteId } = await azienda()
    const k = await contratto(tenantId, clienteId)
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 1, file()))
    await owner.contrattoCliente.update({ where: { id: k.id }, data: { eliminatoIl: new Date() } })
    const inesistente = '00000000-0000-4000-8000-000000000000'
    const audit = () =>
      owner.activityLog.count({
        where: { tenantId, action: { startsWith: 'ALLEGATO_CONTRATTO_CLIENTE_' } },
      })
    const prima = await audit()
    await expect(
      nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 2, file()))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(nel(tenantId, () => service.elenco(tenantId, k.id))).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(
      nel(tenantId, () => service.contenuto(tenantId, k.id, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      nel(tenantId, () => service.rimuovi(tenantId, utenteId, k.id, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    // Nessuna scrittura: l'allegato resta e l'audit non cambia.
    expect(await owner.allegatoContrattoCliente.count({ where: { contrattoId: k.id } })).toBe(1)
    expect(await audit()).toBe(prima)
    await expect(
      nel(tenantId, () => service.carica(tenantId, utenteId, inesistente, 1, file()))
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it("nel contesto di B il contratto e l'allegato di A: 404", async () => {
    const a = await azienda()
    const b = await azienda()
    const k = await contratto(a.tenantId, a.clienteId)
    const v = await nel(a.tenantId, () => service.carica(a.tenantId, a.utenteId, k.id, 1, file()))
    await expect(
      nel(b.tenantId, () => service.carica(b.tenantId, b.utenteId, k.id, 2, file()))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(nel(b.tenantId, () => service.elenco(b.tenantId, k.id))).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(
      nel(b.tenantId, () => service.contenuto(b.tenantId, k.id, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      nel(b.tenantId, () => service.rimuovi(b.tenantId, b.utenteId, k.id, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(await owner.allegatoContrattoCliente.count({ where: { id: v.id } })).toBe(1)
  })

  it('allegato richiesto con il contratto sbagliato (stessa azienda): 404', async () => {
    const { tenantId, utenteId, clienteId } = await azienda()
    const k1 = await contratto(tenantId, clienteId)
    const k2 = await contratto(tenantId, clienteId)
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, k1.id, 1, file()))
    await expect(
      nel(tenantId, () => service.contenuto(tenantId, k2.id, v.id))
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it("due caricamenti nella stessa posizione in parallelo: uno solo riesce, l'altro 409", async () => {
    const { tenantId, utenteId, clienteId } = await azienda()
    const k = await contratto(tenantId, clienteId)
    const esiti = await Promise.allSettled([
      nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 1, file('a'))),
      nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 1, file('b'))),
    ])
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const rifiuto = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
    expect(rifiuto.reason).toBeInstanceOf(ConflictException)
    expect(rifiuto.reason.getResponse()).toMatchObject({ error: 'ALLEGATO_POSIZIONE_OCCUPATA' })
    expect(await owner.allegatoContrattoCliente.count({ where: { contrattoId: k.id } })).toBe(1)
    // L'audit riguarda solo il caricamento riuscito.
    expect(
      await owner.activityLog.count({
        where: { tenantId, action: 'ALLEGATO_CONTRATTO_CLIENTE_CARICATO' },
      })
    ).toBe(1)
  })

  it('posizione già occupata (in sequenza): 409; dopo la rimozione si ricarica', async () => {
    const { tenantId, utenteId, clienteId } = await azienda()
    const k = await contratto(tenantId, clienteId)
    const v = await nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 1, file()))
    await expect(
      nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 1, file('altro')))
    ).rejects.toBeInstanceOf(ConflictException)
    await nel(tenantId, () => service.rimuovi(tenantId, utenteId, k.id, v.id))
    await expect(
      nel(tenantId, () => service.carica(tenantId, utenteId, k.id, 1, file('altro')))
    ).resolves.toMatchObject({ posizione: 1 })
  })

  it('file non PDF o oltre 4 MiB: nessuna riga', async () => {
    const { tenantId, utenteId, clienteId } = await azienda()
    const k = await contratto(tenantId, clienteId)
    const exe = Buffer.from('MZ finto eseguibile')
    await expect(
      nel(tenantId, () =>
        service.carica(tenantId, utenteId, k.id, 1, {
          originalname: 'x.pdf',
          size: exe.length,
          buffer: exe,
        })
      )
    ).rejects.toMatchObject({ status: 415 })
    const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(4 * 1024 * 1024)])
    await expect(
      nel(tenantId, () =>
        service.carica(tenantId, utenteId, k.id, 2, {
          originalname: 'g.pdf',
          size: grande.length,
          buffer: grande,
        })
      )
    ).rejects.toMatchObject({ status: 413 })
    expect(await owner.allegatoContrattoCliente.count({ where: { tenantId } })).toBe(0)
  })
})
