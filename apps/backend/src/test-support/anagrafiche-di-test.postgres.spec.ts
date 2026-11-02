/**
 * La fixture `creaDittaConRuolo` per i ruoli CLIENTE e AGENTE (4.1b): ditta, sede principale e
 * riga di ruolo create col proprietario. Pulizia solo per id esatti creati.
 */
import { PrismaClient } from '@prisma/client'
import { eDatabaseDiTestLocale } from './database-di-test'
import { creaDittaConRuolo, partitaIvaUnica } from './anagrafiche-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

describe('creaDittaConRuolo — CLIENTE e AGENTE (Postgres)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const tenantCreati: string[] = []

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      await owner.cliente.deleteMany({ where: { tenantId: in_ } })
      await owner.agente.deleteMany({ where: { tenantId: in_ } })
      await owner.tenant.deleteMany({ where: { id: in_ } })
    }
    await owner.$disconnect()
  })

  it('crea un cliente e un agente sulla ditta con la sede principale', async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Fixture SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)

    const c = await creaDittaConRuolo(owner, t.id, 'CLIENTE', { ragioneSociale: 'Cliente Uno' })
    const a = await creaDittaConRuolo(owner, t.id, 'AGENTE')

    const cliente = await owner.cliente.findUniqueOrThrow({ where: { id: c.ruoloId } })
    expect(cliente).toMatchObject({ tenantId: t.id, dittaId: c.dittaId, sedeId: c.sedeId })
    const agente = await owner.agente.findUniqueOrThrow({ where: { id: a.ruoloId } })
    expect(agente).toMatchObject({ tenantId: t.id, dittaId: a.dittaId, sedeId: a.sedeId })
    const sede = await owner.sedeDitta.findUniqueOrThrow({ where: { id: c.sedeId } })
    expect(sede.principale).toBe(true)
  })
})
