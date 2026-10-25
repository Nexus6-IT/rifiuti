/**
 * Il seed dei ruoli di sistema non deve dare ruoli all'azienda piattaforma (tecnica, senza utenti).
 * Postgres reale: il seed gira davvero (client di sistema) con la riga piattaforma presente.
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { AZIENDA_PIATTAFORMA_ID } from '../../core/context/azienda-piattaforma'

describe('roles.seed e azienda piattaforma (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const sfx = Date.now().toString().slice(-8)
  let clienteId = ''
  let utenteId = ''
  let ruoliPrima = new Set<string>()

  beforeAll(async () => {
    ruoliPrima = new Set((await owner.role.findMany({ select: { id: true } })).map(r => r.id))
    const t = await owner.tenant.create({
      data: { partitaIva: `RS${sfx}`.slice(0, 11), ragioneSociale: `Seed ${sfx}` },
    })
    clienteId = t.id
    const u = await owner.user.create({
      data: {
        tenantId: clienteId,
        keycloakId: randomUUID(),
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'S',
        lastName: 'S',
        email: `seed${sfx}@example.test`,
      },
    })
    utenteId = u.id
  })

  afterAll(async () => {
    const nuovi = (await owner.role.findMany({ select: { id: true } }))
      .map(r => r.id)
      .filter(id => !ruoliPrima.has(id))
    await owner.rolePermission.deleteMany({ where: { roleId: { in: nuovi } } })
    await owner.role.deleteMany({ where: { id: { in: nuovi } } })
    await owner.user.delete({ where: { id: utenteId } })
    await owner.tenant.delete({ where: { id: clienteId } })
    await owner.$disconnect()
  })

  it('con la piattaforma presente, il seed crea ruoli ai clienti e nessuno alla piattaforma', async () => {
    expect(await owner.tenant.count({ where: { id: AZIENDA_PIATTAFORMA_ID } })).toBe(1)
    const { seedRoles } = await import('../../../prisma/seeds/roles.seed')
    await seedRoles()
    expect(await owner.role.count({ where: { tenantId: AZIENDA_PIATTAFORMA_ID } })).toBe(0)
    expect(await owner.role.count({ where: { tenantId: clienteId } })).toBeGreaterThan(0)
  })
})
