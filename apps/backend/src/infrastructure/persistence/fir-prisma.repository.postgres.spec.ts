import { PrismaClient } from '@prisma/client'
import { FIRPrismaRepository } from './fir-prisma.repository'

/**
 * R2 Task 3, Step 4 — vincolo di unicità (tenant_id, rentri_numero_fir) su
 * "firs": contro un database Postgres reale (non un mock), non contro il
 * vincolo applicativo dell'aggregate (già coperto in fir.aggregate.spec.ts).
 * Un controllo applicativo si aggira (due scritture concorrenti passano
 * entrambe il controllo prima che una delle due arrivi al DB); solo il
 * vincolo di database garantisce l'anti-doppio-legame in ogni caso. Questo
 * test verifica che il repository traduca la violazione Postgres
 * (P2002/unique constraint) in un errore di dominio leggibile
 * (FormularioGiaAgganciatoError), non lasciarla risalire grezza.
 */
describe('FIRPrismaRepository — vincolo di unicità (tenant_id, rentri_numero_fir) su Postgres reale', () => {
  let prisma: PrismaClient
  let repo: FIRPrismaRepository
  let tenantId: string
  let userId: string

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    repo = new FIRPrismaRepository(prisma as any)

    const tenant = await prisma.tenant.create({
      data: {
        partitaIva: `UQ${Date.now().toString().slice(-9)}`,
        ragioneSociale: 'Vincolo Unicità Test SRL',
        country: 'IT',
      },
    })
    tenantId = tenant.id

    const user = await prisma.user.create({
      data: {
        tenantId,
        keycloakId: `keycloak-uq-${Date.now()}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `uq-${Date.now()}@example.com`,
        role: 'OPERATOR',
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    await prisma.fIR.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  // producerId/carrierId/receiverId sono colonne @db.Uuid (nullable):
  // producerId/trasportatoreId/destinatarioId dell'aggregate devono quindi
  // essere UUID validi in un test contro Postgres reale (a differenza dei
  // test con Prisma mockato sopra, che non validano il formato).
  const REGISTRO_PRODUTTORE = '11111111-1111-4111-8111-111111111111'
  const REGISTRO_TRASPORTATORE = '22222222-2222-4222-8222-222222222222'
  const REGISTRO_DESTINATARIO = '33333333-3333-4333-8333-333333333333'

  function buildFirAgganciato(numeroFir: string): FIR {
    const fir = FIR.create({
      produttoreId: REGISTRO_PRODUTTORE,
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: REGISTRO_TRASPORTATORE,
      destinatarioId: REGISTRO_DESTINATARIO,
      tenantId,
      creatoDaUserId: userId,
    })
    fir.agganciaFormularioAcquisito(numeroFir)
    return fir
  }

  it('salva senza errori il primo FIR agganciato a un numero_fir', async () => {
    const fir = buildFirAgganciato(`RENTRI-UQ-${Date.now()}-A`)
    await expect(repo.save(fir)).resolves.not.toThrow()
  })

  it('rifiuta un secondo FIR dello stesso tenant agganciato allo STESSO numero_fir, con un errore di dominio leggibile', async () => {
    const numeroFir = `RENTRI-UQ-${Date.now()}-B`
    const primoFir = buildFirAgganciato(numeroFir)
    await repo.save(primoFir)

    const secondoFir = buildFirAgganciato(numeroFir)

    await expect(repo.save(secondoFir)).rejects.toThrow(FormularioGiaAgganciatoError)
    await expect(repo.save(secondoFir)).rejects.toThrow(numeroFir)
  })

  it('non impedisce due FIR NON legati (rentriNumeroFir null): NULL sono distinti fra loro in Postgres', async () => {
    const primoFir = FIR.create({
      produttoreId: REGISTRO_PRODUTTORE,
      rifiuto: { cerCode: '150101', quantita: 50 },
      trasportatoreId: REGISTRO_TRASPORTATORE,
      destinatarioId: REGISTRO_DESTINATARIO,
      tenantId,
      creatoDaUserId: userId,
    })
    const secondoFir = FIR.create({
      produttoreId: REGISTRO_PRODUTTORE,
      rifiuto: { cerCode: '150101', quantita: 60 },
      trasportatoreId: REGISTRO_TRASPORTATORE,
      destinatarioId: REGISTRO_DESTINATARIO,
      tenantId,
      creatoDaUserId: userId,
    })

    await expect(repo.save(primoFir)).resolves.not.toThrow()
    await expect(repo.save(secondoFir)).resolves.not.toThrow()
  })
})
