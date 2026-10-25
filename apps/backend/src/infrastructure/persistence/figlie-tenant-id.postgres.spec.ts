import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * RLS pezzo 3, Task 2: `tenant_id` sulle quattro tabelle figlie (firme, trasportatori,
 * allegati RENTRI, discariche delle autorizzazioni), coerente col padre.
 * Contro un PostgreSQL reale: la coerenza e il CASCADE sono vincoli del database.
 */
const MIGRATION = join(
  __dirname,
  '../../../prisma/migrations/20261025120000_tenant_id_tabelle_figlie/migration.sql'
)

/** Le istruzioni della migration, senza commenti, una per elemento. */
function istruzioniMigration(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter(r => !r.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

const REG_P = '11111111-1111-4111-8111-111111111111'
const REG_T = '22222222-2222-4222-8222-222222222222'
const REG_D = '33333333-3333-4333-8333-333333333333'

describe('tabelle figlie: tenant_id coerente col padre (Postgres reale)', () => {
  let prisma: PrismaClient
  let repo: FIRPrismaRepository
  let tenantA: string
  let tenantB: string
  let userA: string
  const sfx = Date.now().toString().slice(-8)

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    repo = new FIRPrismaRepository(prisma as any, prisma as any)
    const mk = async (tag: string) => {
      const t = await prisma.tenant.create({
        data: {
          partitaIva: `F${tag}${sfx}`.slice(0, 11),
          ragioneSociale: `Figlie ${tag}`,
          country: 'IT',
        },
      })
      return t.id
    }
    tenantA = await mk('A')
    tenantB = await mk('B')
    userA = (
      await prisma.user.create({
        data: {
          tenantId: tenantA,
          keycloakId: `kc-figlie-${sfx}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `figlie-${sfx}@example.com`,
          role: 'OPERATOR',
        },
      })
    ).id
  })

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) {
      if (!t) continue
      await prisma.fIR.deleteMany({ where: { tenantId: t } })
      await prisma.autorizzazioneImpianto.deleteMany({ where: { tenantId: t } })
      await prisma.user.deleteMany({ where: { tenantId: t } })
      await prisma.tenant.deleteMany({ where: { id: t } })
    }
    await prisma.$disconnect()
  })

  function nuovoFir(tenantId: string, creatoDaUserId: string, extra: object = {}): FIR {
    return FIR.create({
      produttoreId: REG_P,
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: REG_T,
      destinatarioId: REG_D,
      tenantId,
      creatoDaUserId,
      ...extra,
    } as any)
  }

  it('figlie: tenant_id riempito dal padre per le righe esistenti', async () => {
    const fir = nuovoFir(tenantA, userA)
    await repo.save(fir)
    const aut = await prisma.autorizzazioneImpianto.create({
      data: { tenantId: tenantA, estremi: 'T2-0' },
    })

    const rb = new Error('rollback')
    await expect(
      prisma.$transaction(async tx => {
        // Riporta lo schema alla forma di prima della migration (DDL transazionale:
        // alla fine si annulla tutto con il rollback).
        for (const t of ['fir_signatures', 'fir_transporters', 'fir_allegati_rentri']) {
          await tx.$executeRawUnsafe(
            `ALTER TABLE "${t}" DROP CONSTRAINT "${t}_fir_id_tenant_id_fkey"`
          )
          // La policy (migration successiva) dipende dalla colonna: va tolta prima.
          await tx.$executeRawUnsafe(`DROP POLICY IF EXISTS isolamento_azienda ON "${t}"`)
          await tx.$executeRawUnsafe(`ALTER TABLE "${t}" DROP COLUMN "tenant_id"`)
          await tx.$executeRawUnsafe(
            `ALTER TABLE "${t}" ADD CONSTRAINT "${t}_fir_id_fkey" FOREIGN KEY ("fir_id") REFERENCES "firs"("id") ON DELETE CASCADE ON UPDATE CASCADE`
          )
        }
        await tx.$executeRawUnsafe(
          `ALTER TABLE "autorizzazioni_impianto_discariche" DROP CONSTRAINT "autorizzazioni_impianto_discariche_autorizzazione_id_tenan_fkey"`
        )
        await tx.$executeRawUnsafe(
          `DROP POLICY IF EXISTS isolamento_azienda ON "autorizzazioni_impianto_discariche"`
        )
        await tx.$executeRawUnsafe(
          `ALTER TABLE "autorizzazioni_impianto_discariche" DROP COLUMN "tenant_id"`
        )
        await tx.$executeRawUnsafe(
          `ALTER TABLE "autorizzazioni_impianto_discariche" ADD CONSTRAINT "autorizzazioni_impianto_discariche_autorizzazione_id_fkey" FOREIGN KEY ("autorizzazione_id") REFERENCES "autorizzazioni_impianto"("id") ON DELETE CASCADE ON UPDATE CASCADE`
        )
        await tx.$executeRawUnsafe(`DROP INDEX "firs_id_tenant_id_key"`)
        await tx.$executeRawUnsafe(`DROP INDEX "autorizzazioni_impianto_id_tenant_id_key"`)

        // Righe "legacy" senza tenant_id.
        await tx.$executeRawUnsafe(
          `INSERT INTO "fir_transporters" ("fir_id","ordine","tipo_tratta","denominazione") VALUES ('${fir.id}'::uuid, 1, 'TERRESTRE', 'Legacy')`
        )
        await tx.$executeRawUnsafe(
          `INSERT INTO "autorizzazioni_impianto_discariche" ("autorizzazione_id") VALUES ('${aut.id}'::uuid)`
        )

        for (const istr of istruzioniMigration()) await tx.$executeRawUnsafe(istr)

        const t = await tx.$queryRawUnsafe<{ tenant_id: string }[]>(
          `SELECT tenant_id::text FROM fir_transporters WHERE fir_id = '${fir.id}'::uuid`
        )
        const d = await tx.$queryRawUnsafe<{ tenant_id: string }[]>(
          `SELECT tenant_id::text FROM autorizzazioni_impianto_discariche WHERE autorizzazione_id = '${aut.id}'::uuid`
        )
        expect(t.map(r => r.tenant_id)).toEqual([tenantA])
        expect(d.map(r => r.tenant_id)).toEqual([tenantA])
        throw rb
      })
    ).rejects.toBe(rb)
  })

  it('figlie: tenant_id diverso dal padre rifiutato dal database', async () => {
    const fir = nuovoFir(tenantA, userA)
    await repo.save(fir)
    const aut = await prisma.autorizzazioneImpianto.create({
      data: { tenantId: tenantA, estremi: 'T2-1' },
    })

    await expect(
      prisma.fIRTransporter.create({
        data: {
          firId: fir.id,
          tenantId: tenantB,
          ordine: 1,
          tipoTratta: 'TERRESTRE' as any,
          denominazione: 'X',
        },
      })
    ).rejects.toThrow()
    await expect(
      prisma.fIRSignature.create({
        data: {
          firId: fir.id,
          tenantId: tenantB,
          userId: userA,
          role: 'PRODUTTORE',
          signedAt: new Date(),
          signatureValue: 'x',
          certificateHash: 'x',
          documentHash: 'x',
        },
      })
    ).rejects.toThrow()
    await expect(
      prisma.fIRAllegatoRentri.create({
        data: {
          firId: fir.id,
          tenantId: tenantB,
          rentriAllegatoId: 1,
          filename: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
          caricatoDa: userA,
        },
      })
    ).rejects.toThrow()
    await expect(
      prisma.autorizzazioneImpiantoDiscarica.create({
        data: { autorizzazioneId: aut.id, tenantId: tenantB },
      })
    ).rejects.toThrow()
    // Col tenant giusto passa.
    await prisma.autorizzazioneImpiantoDiscarica.create({
      data: { autorizzazioneId: aut.id, tenantId: tenantA },
    })
  })

  it('firma/trasportatore/allegato creati dal codice con il tenant del FIR', async () => {
    const fir = nuovoFir(tenantA, userA, {
      trasportatoriAggiuntivi: [
        { ordine: 2, tipoTratta: 'FERROVIARIA', denominazione: 'Treni SRL' },
      ],
    })
    await repo.save(fir)
    fir.emetti(`FIR-2099-${sfx}`, {
      firmatario: 'Mario Rossi',
      timestamp: new Date(),
      certificato: 'x',
      userId: userA,
    })
    await repo.save(fir)

    const firme = await prisma.fIRSignature.findMany({ where: { firId: fir.id } })
    const tratte = await prisma.fIRTransporter.findMany({ where: { firId: fir.id } })
    expect(firme).toHaveLength(1)
    expect(tratte).toHaveLength(1)
    expect(firme[0].tenantId).toBe(tenantA)
    expect(tratte[0].tenantId).toBe(tenantA)
  })

  it('cancellazione del FIR: figlie cancellate (CASCADE invariato)', async () => {
    const fir = nuovoFir(tenantA, userA, {
      trasportatoriAggiuntivi: [
        { ordine: 2, tipoTratta: 'FERROVIARIA', denominazione: 'Treni SRL' },
      ],
    })
    await repo.save(fir)
    await prisma.fIRAllegatoRentri.create({
      data: {
        firId: fir.id,
        tenantId: tenantA,
        rentriAllegatoId: 7,
        filename: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        caricatoDa: userA,
      },
    })
    const aut = await prisma.autorizzazioneImpianto.create({
      data: { tenantId: tenantA, estremi: 'T2-2' },
    })
    await prisma.autorizzazioneImpiantoDiscarica.create({
      data: { autorizzazioneId: aut.id, tenantId: tenantA },
    })

    await prisma.fIR.delete({ where: { id: fir.id } })
    await prisma.autorizzazioneImpianto.delete({ where: { id: aut.id } })

    expect(await prisma.fIRTransporter.count({ where: { firId: fir.id } })).toBe(0)
    expect(await prisma.fIRAllegatoRentri.count({ where: { firId: fir.id } })).toBe(0)
    expect(
      await prisma.autorizzazioneImpiantoDiscarica.count({ where: { autorizzazioneId: aut.id } })
    ).toBe(0)
  })
})
