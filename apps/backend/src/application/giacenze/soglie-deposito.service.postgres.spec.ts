/**
 * Servizio delle soglie del deposito temporaneo (Fase 2 pezzo 6, Task 4) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS ENABLE+FORCE soggetta alle policy) e dentro il
 * `TenantContext` dell'azienda. Il proprietario prepara aziende, utenti e registri e legge cio'
 * che e' stato scritto; la pulizia toglie solo le righe create qui.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
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
import { RegistroNonTrovatoError } from '../registro/registri.service'
import { SoglieDepositoService } from './soglie-deposito.service'

describe('SoglieDepositoService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: SoglieDepositoService
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `SS${suffisso}`, ragioneSociale: 'Soglie servizio SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-soglie-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `soglie-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const registri = []
    for (const nome of ['Registro 1', 'Registro 2']) {
      registri.push(
        await owner.registroRifiuti.create({
          data: { tenantId: t.id, descrizione: nome, codice: `C${++n}` },
        })
      )
    }
    return { tenantId: t.id, utenteId: utente.id, r1: registri[0].id, r2: registri[1].id }
  }

  const dati = (kgMaxTotale: number) => ({
    criterio: 'TEMPORALE' as const,
    giorniMax: null,
    kgMaxTotale,
    kgMaxPericolosi: 5000,
    preavvisoGiorni: 15,
    preavvisoPercentuale: 80,
    note: null,
  })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    service = new SoglieDepositoService(app)
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    for (const k of [2, 4]) {
      await Promise.all(
        Array.from({ length: k }, () => app.$queryRaw`SELECT pg_sleep(0.05)::text AS s`)
      )
    }
  })

  afterAll(async () => {
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.sogliaDepositoTemporaneo.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.user.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('imposta due volte la riga azienda: una riga aggiornata, audit per entrambe', async () => {
    const a = await azienda()
    await nelTenant(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, null, dati(10000)))
    const out = await nelTenant(a.tenantId, () =>
      service.imposta(a.tenantId, a.utenteId, null, dati(12000))
    )
    expect(out.kgMaxTotale).toBe(12000)
    const righe = await owner.sogliaDepositoTemporaneo.findMany({ where: { tenantId: a.tenantId } })
    expect(righe).toHaveLength(1)
    expect(Number(righe[0].kgMaxTotale)).toBe(12000)
    const audit = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'DEPOSITO_SOGLIE_IMPOSTATE' },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit).toHaveLength(2)
    expect((audit[1].metadata as any).prima.kgMaxTotale).toBe(10000)
    expect((audit[1].metadata as any).dopo.kgMaxTotale).toBe(12000)
  })

  it('due imposta concorrenti sulla riga azienda: una riga, nessun errore di unicita', async () => {
    const a = await azienda()
    await Promise.all([
      nelTenant(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, null, dati(11000))),
      nelTenant(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, null, dati(13000))),
    ])
    const righe = await owner.sogliaDepositoTemporaneo.findMany({ where: { tenantId: a.tenantId } })
    expect(righe).toHaveLength(1)
    expect([11000, 13000]).toContain(Number(righe[0].kgMaxTotale))
  })

  it('soglieApplicate per due registri, con e senza riga propria', async () => {
    const a = await azienda()
    await nelTenant(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, null, dati(20000)))
    await nelTenant(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, a.r1, dati(7000)))
    const m = await nelTenant(a.tenantId, () => service.soglieApplicate(a.tenantId, [a.r1, a.r2]))
    expect(m.get(a.r1)).toMatchObject({ origine: 'REGISTRO', kgMaxTotale: 7000 })
    expect(m.get(a.r2)).toMatchObject({ origine: 'AZIENDA', kgMaxTotale: 20000 })
    const config = await nelTenant(a.tenantId, () => service.leggiConfigurazione(a.tenantId))
    expect(config.registri.find(r => r.registroId === a.r1)?.soglie?.kgMaxTotale).toBe(7000)
    expect(config.registri.find(r => r.registroId === a.r2)?.soglie).toBeNull()
  })

  it('elimina: la riga del registro torna al livello superiore; audit presente', async () => {
    const a = await azienda()
    await nelTenant(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, a.r1, dati(7000)))
    await nelTenant(a.tenantId, () => service.elimina(a.tenantId, a.utenteId, a.r1))
    await nelTenant(a.tenantId, () => service.elimina(a.tenantId, a.utenteId, a.r1))
    const m = await nelTenant(a.tenantId, () => service.soglieApplicate(a.tenantId, [a.r1]))
    expect(m.get(a.r1)?.origine).toBe('PREDEFINITA')
    const audit = await owner.activityLog.count({
      where: { tenantId: a.tenantId, action: 'DEPOSITO_SOGLIE_RIMOSSE' },
    })
    expect(audit).toBe(1)
  })

  it('il contesto di B non vede le soglie di A e non ne usa i registri', async () => {
    const a = await azienda()
    const b = await azienda()
    await nelTenant(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, null, dati(9000)))
    await nelTenant(a.tenantId, () => service.imposta(a.tenantId, a.utenteId, a.r1, dati(8000)))

    const config = await nelTenant(b.tenantId, () => service.leggiConfigurazione(b.tenantId))
    expect(config.azienda).toBeNull()
    expect(config.registri.every(r => r.soglie === null)).toBe(true)

    const m = await nelTenant(b.tenantId, () => service.soglieApplicate(b.tenantId, [a.r1]))
    expect(m.get(a.r1)?.origine).toBe('PREDEFINITA')

    await expect(
      nelTenant(b.tenantId, () => service.imposta(b.tenantId, b.utenteId, a.r1, dati(5000)))
    ).rejects.toBeInstanceOf(RegistroNonTrovatoError)
    await expect(
      nelTenant(b.tenantId, () => service.elimina(b.tenantId, b.utenteId, a.r1))
    ).rejects.toBeInstanceOf(RegistroNonTrovatoError)
    expect(await owner.sogliaDepositoTemporaneo.count({ where: { tenantId: a.tenantId } })).toBe(2)
  })

  it('un contesto diverso dal tenant richiesto e rifiutato', async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(
      nelTenant(b.tenantId, () => service.leggiConfigurazione(a.tenantId))
    ).rejects.toThrow(/non coincide/)
  })
})
