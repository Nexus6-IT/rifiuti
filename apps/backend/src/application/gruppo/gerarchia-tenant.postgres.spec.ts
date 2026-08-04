/**
 * Gerarchia madre-figlie a livello di database.
 *
 * Richiede un PostgreSQL reale: il vincolo ON DELETE RESTRICT e il
 * comportamento dei NULL non sono dimostrabili con una finta.
 * Eseguire con `npm run test:postgres` (escluso dal gate CI: il runner non ha DB).
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** P.IVA valide e irripetibili fra esecuzioni: il campo è @unique. */
const piva = () => String(Date.now()).slice(-9).padStart(11, '1')

describe('Gerarchia madre-figlie (Postgres reale)', () => {
  const creati: string[] = []

  afterAll(async () => {
    // Prima le figlie: la FK con RESTRICT vieta di cancellare una madre con figlie.
    for (const id of [...creati].reverse()) {
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  })

  it('una figlia referenzia la madre e la madre elenca le figlie', async () => {
    const madre = await prisma.tenant.create({
      data: { partitaIva: piva(), ragioneSociale: 'Gruppo Madre Srl' },
    })
    creati.push(madre.id)

    const figlia = await prisma.tenant.create({
      data: {
        partitaIva: piva(),
        ragioneSociale: 'Figlia Alfa Srl',
        parentTenantId: madre.id,
      },
    })
    creati.push(figlia.id)

    const conFiglie = await prisma.tenant.findUnique({
      where: { id: madre.id },
      include: { figlie: { select: { id: true } } },
    })

    expect(conFiglie!.parentTenantId).toBeNull()
    expect(conFiglie!.figlie.map(f => f.id)).toEqual([figlia.id])
  })

  it('una madre con figlie non e cancellabile (ON DELETE RESTRICT)', async () => {
    const madre = await prisma.tenant.create({
      data: { partitaIva: piva(), ragioneSociale: 'Madre Indelebile Srl' },
    })
    creati.push(madre.id)
    const figlia = await prisma.tenant.create({
      data: { partitaIva: piva(), ragioneSociale: 'Figlia Beta Srl', parentTenantId: madre.id },
    })
    creati.push(figlia.id)

    await expect(prisma.tenant.delete({ where: { id: madre.id } })).rejects.toThrow()
  })

  it('aziendeLimit e nullable: i tenant esistenti restano invariati', async () => {
    const radice = await prisma.tenant.create({
      data: { partitaIva: piva(), ragioneSociale: 'Radice Senza Quota Srl' },
    })
    creati.push(radice.id)

    expect(radice.aziendeLimit).toBeNull()
  })
})
