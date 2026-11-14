/**
 * Permesso di simulazione delle pese (4.8b, Q2) contro un Postgres reale: `TenantService.
 * impostaSimulazionePese` aggiorna `tenants.pese_simulazione_ammessa` e scrive l'audit
 * `PESA_SIMULAZIONE_AMMESSA` / `_REVOCATA` nell'azienda, nella stessa transazione.
 * Il proprietario prepara e pulisce solo le righe create qui, per id.
 */
import { PrismaClient, UserRole } from '@prisma/client'
import { TenantService } from './tenant.service'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55444/wasteflow_ci?schema=public'

describe('TenantService.impostaSimulazionePese (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const creati: string[] = []

  afterAll(async () => {
    if (creati.length) await owner.tenant.deleteMany({ where: { id: { in: creati } } })
    await owner.$disconnect()
  })

  it('ammette e poi revoca: colonna aggiornata e un audit per ogni cambio, con l’autore', async () => {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(9_990_000 + (Date.now() % 9_000)),
        ragioneSociale: 'Simulazione SRL',
        country: 'IT',
      },
    })
    creati.push(t.id)
    const super_ = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-sim-${Date.now()}`,
        fiscalCode: `SIM${Date.now()}`.slice(0, 16),
        firstName: 'Super',
        lastName: 'Admin',
        email: `sim-${Date.now()}@example.test`,
      },
    })
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const servizio = new TenantService(
      owner as never,
      owner as never,
      logger,
      {} as never,
      {
        caricaContratto: jest.fn(),
      } as never
    )
    const utente = {
      id: super_.id,
      email: super_.email,
      tenantId: t.id,
      role: UserRole.SUPER_ADMIN,
      permissions: [],
    }

    await servizio.impostaSimulazionePese(utente as never, t.id, true)
    expect(
      (await owner.tenant.findUniqueOrThrow({ where: { id: t.id } })).peseSimulazioneAmmessa
    ).toBe(true)
    await servizio.impostaSimulazionePese(utente as never, t.id, false)
    expect(
      (await owner.tenant.findUniqueOrThrow({ where: { id: t.id } })).peseSimulazioneAmmessa
    ).toBe(false)

    const audit = await owner.activityLog.findMany({
      where: { tenantId: t.id, action: { startsWith: 'PESA_SIMULAZIONE' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map(a => a.action)).toEqual([
      'PESA_SIMULAZIONE_AMMESSA',
      'PESA_SIMULAZIONE_REVOCATA',
    ])
    expect(audit.every(a => a.userId === super_.id)).toBe(true)
  })

  it('azienda inesistente: 404', async () => {
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const servizio = new TenantService(
      owner as never,
      owner as never,
      logger,
      {} as never,
      {} as never
    )
    await expect(
      servizio.impostaSimulazionePese(
        { id: 'x', role: UserRole.SUPER_ADMIN } as never,
        '00000000-0000-4000-8000-0000000000aa',
        true
      )
    ).rejects.toThrow(/non trovato/)
  })
})
