import { PrismaClient } from '@prisma/client'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { FormularioGiaAgganciatoError } from '../../core/domain/errors'

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

  describe('rentriStatoFormulario', () => {
    // findById usa this.prisma.db: serve un client con la proprietà `db`.
    let repoLettura: FIRPrismaRepository
    beforeAll(() => {
      repoLettura = new FIRPrismaRepository(Object.assign(prisma, { db: prisma }) as any)
    })

    it('rentriStatoFormulario sopravvive a save e findById', async () => {
      const fir = buildFirAgganciato(`RENTRI-SF-${Date.now()}`)
      await repoLettura.save(fir)
      fir.applyRentriStato('Annullato')
      await repoLettura.save(fir)
      expect(
        (await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })).rentriStatoFormulario
      ).toBe('Annullato')
      expect((await repoLettura.findById(fir.id))!.rentriStatoFormulario).toBe('Annullato')
    })

    it('un salvataggio successivo non cancella lo stato dell ente', async () => {
      const fir = buildFirAgganciato(`RENTRI-SF2-${Date.now()}`)
      fir.applyRentriStato('RespintoAccettatoParzialmente')
      await repoLettura.save(fir)
      const riletto = (await repoLettura.findById(fir.id))!
      await repoLettura.save(riletto) // salvataggio per un altro motivo
      expect((await repoLettura.findById(fir.id))!.rentriStatoFormulario).toBe(
        'RespintoAccettatoParzialmente'
      )
    })

    it('un FIR mai riconciliato resta con rentriStatoFormulario null', async () => {
      const fir = buildFirAgganciato(`RENTRI-SF3-${Date.now()}`)
      await repoLettura.save(fir)
      expect((await repoLettura.findById(fir.id))!.rentriStatoFormulario).toBeNull()
    })
  })

  describe('atomicità di stato e firme', () => {
    function buildFirBozza(): FIR {
      return FIR.create({
        produttoreId: REGISTRO_PRODUTTORE,
        rifiuto: { cerCode: '150101', quantita: 100 },
        trasportatoreId: REGISTRO_TRASPORTATORE,
        destinatarioId: REGISTRO_DESTINATARIO,
        tenantId,
        creatoDaUserId: userId,
      })
    }

    it('se la firma non si può scrivere, lo stato del FIR non cambia', async () => {
      const fir = buildFirBozza()
      await repo.save(fir) // BOZZA
      fir.emetti('FIR-2099-000001', {
        firmatario: 'Mario Rossi',
        timestamp: new Date(),
        certificato: 'x',
        // utente inesistente: la scrittura della firma viola la FK, dopo l'upsert del FIR
        userId: '99999999-9999-4999-8999-999999999999',
      })

      await expect(repo.save(fir)).rejects.toThrow()

      const riletto = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
      expect(riletto.status).toBe('DRAFT')
      expect(riletto.firNumber).toBeNull()
      expect(await prisma.fIRSignature.count({ where: { firId: fir.id } })).toBe(0)
    })

    it('con una firma scrivibile, stato e firma risultano salvati insieme', async () => {
      const fir = buildFirBozza()
      await repo.save(fir)
      fir.emetti('FIR-2099-000002', {
        firmatario: 'Mario Rossi',
        timestamp: new Date(),
        certificato: 'x',
        userId,
      })

      await repo.save(fir)

      const riletto = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
      expect(riletto.status).toBe('AWAITING_CARRIER')
      expect(riletto.firNumber).toBe('FIR-2099-000002')
      expect(await prisma.fIRSignature.count({ where: { firId: fir.id } })).toBe(1)
    })
  })
})
