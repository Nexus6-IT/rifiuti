/**
 * Fase 3 (3.1), Task 7, test (b) e perimetro Q5, contro Postgres reale. Il proprietario prepara i FIR
 * (anche quelli importati, che il database vuole bloccati) e il repository li rilegge: il job di
 * ripresa NON deve elencare un FIR importato `PENDING` ne' un `SYNCING` stallato, in un'azienda
 * AUTOMATICA e in una IBRIDA; il FIR normale equivalente si'. Un FIR riacquisito da RENTRI nasce
 * legato e non e' un import: non e' bloccato.
 */
import { PrismaClient } from '@prisma/client'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'

describe('Fase 3 (3.1): FIR importati e job di ripresa — Postgres reale', () => {
  const prisma = new PrismaClient()
  let repo: FIRPrismaRepository
  const tenantCreati: string[] = []
  let n = 0
  const seme = 8_000_000 + (Date.now() % 900_000)
  const SOGLIA = new Date('2026-10-23T09:50:00.000Z')
  const VECCHIO = new Date('2026-10-20T10:00:00.000Z')
  const TETTO = new Date('2026-10-01T00:00:00.000Z')

  async function azienda(modalita: 'AUTOMATICA' | 'IBRIDA') {
    n++
    const t = await prisma.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: `FIR importati ${modalita}`,
        country: 'IT',
        rentriModalitaLegame: modalita,
        subscriptionStatus: 'ACTIVE',
      },
    })
    tenantCreati.push(t.id)
    const user = await prisma.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-firimp7-${seme}-${n}`,
        fiscalCode: `FIRJ${seme}${n}`.slice(0, 16),
        firstName: 'Prova',
        lastName: 'Importati',
        email: `firimp7-${seme}-${n}@example.test`,
      },
    })
    const lotto = await prisma.lottoImport.create({
      data: {
        tenantId: t.id,
        importSource: 'WINWASTE',
        archivio: 'WW00012026',
        ambito: 'FIR',
        formatoStaging: 'winwaste-staging/1',
        hashStaging: 'd'.repeat(64),
      },
    })
    return { tenantId: t.id, userId: user.id, lottoId: lotto.id }
  }
  type Az = Awaited<ReturnType<typeof azienda>>

  /** FIR grezzo "emesso" (AWAITING_CARRIER), importato o no; `updated_at` forzato in SQL. */
  async function fir(
    az: Az,
    opz: { importato: boolean; sync?: 'PENDING' | 'SYNCING'; avviatoAt?: Date | null }
  ): Promise<string> {
    n++
    const r = await prisma.fIR.create({
      data: {
        tenantId: az.tenantId,
        producerUserId: az.userId,
        producerPartitaIva: '00000000000',
        producerName: 'Produttore',
        producerAddress: 'Via Roma 1',
        carrierPartitaIva: '00000000001',
        carrierName: 'Trasportatore',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '00000000002',
        receiverName: 'Destinatario',
        receiverAddress: 'Via Roma 2',
        cerCode: '15 01 01',
        wasteDescription: 'Imballaggi',
        wasteCategory: 'Non pericoloso',
        quantity: 5,
        transportDate: new Date('2026-03-05T08:00:00Z'),
        provenienza: 'SPECIALE',
        firNumber: `FIR/IMP7/${seme}/${n}`,
        status: 'AWAITING_CARRIER',
        rentriSyncStatus: opz.sync ?? 'PENDING',
        rentriSyncAvviatoAt: opz.avviatoAt ?? null,
        ...(opz.importato
          ? {
              importSource: 'WINWASTE',
              legacyKey: `0001|2026|FORMULARI|${seme}${n}`,
              lottoImportId: az.lottoId,
              bloccatoInvio: true,
              motivoBloccoInvio: 'Importato: invio a RENTRI bloccato fino alla riconciliazione',
            }
          : {}),
      } as never,
    })
    await prisma.$executeRaw`UPDATE firs SET updated_at = (${VECCHIO.toISOString()}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${r.id}::uuid`
    return r.id
  }

  const elenca = (az: Az) =>
    repo.elencaTrasmissioniRentriSospese(SOGLIA, 1000, TETTO, [az.tenantId])

  beforeAll(async () => {
    await prisma.$connect()
    repo = new FIRPrismaRepository(Object.assign(prisma, { db: prisma }) as any, prisma as any)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await prisma.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await prisma.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await prisma.$disconnect()
  })

  it.each(['AUTOMATICA', 'IBRIDA'] as const)(
    "(b) %s: il job di ripresa non elenca ne' il PENDING ne' il SYNCING stallato di un FIR importato; il normale si",
    async modalita => {
      const az = await azienda(modalita)
      const importatoPending = await fir(az, { importato: true })
      const importatoSyncing = await fir(az, {
        importato: true,
        sync: 'SYNCING',
        avviatoAt: new Date('2026-10-23T09:00:00.000Z'),
      })
      const importatoSyncingSenzaData = await fir(az, {
        importato: true,
        sync: 'SYNCING',
        avviatoAt: null,
      })
      const normalePending = await fir(az, { importato: false })
      const normaleSyncing = await fir(az, {
        importato: false,
        sync: 'SYNCING',
        avviatoAt: new Date('2026-10-23T09:00:00.000Z'),
      })

      const elenco = await elenca(az)
      const ids = elenco.map(e => e.firId)

      expect(ids).toEqual(expect.arrayContaining([normalePending, normaleSyncing]))
      expect(elenco.find(e => e.firId === normalePending)!.stato).toBe('PENDING')
      expect(elenco.find(e => e.firId === normaleSyncing)!.stato).toBe('SYNCING')
      for (const importato of [importatoPending, importatoSyncing, importatoSyncingSenzaData]) {
        expect(ids).not.toContain(importato)
      }
    }
  )

  it('il repository rilegge il blocco: findById di un importato ha bloccatoInvio e canSyncToRENTRI falso', async () => {
    const az = await azienda('AUTOMATICA')
    const id = await fir(az, { importato: true })
    const letto = (await repo.findById(id))!
    expect(letto.bloccatoInvio).toBe(true)
    expect(letto.motivoBloccoInvio).toContain('riconciliazione')
    expect(letto.canSyncToRENTRI()).toBe(false)
  })

  it("un save dell'aggregate non tocca il blocco (sola lettura: la guardia del database non scatta)", async () => {
    const az = await azienda('AUTOMATICA')
    const id = await fir(az, { importato: true })
    const letto = (await repo.findById(id))!
    ;(letto as any)._annotazioni = 'nota'
    await repo.save(letto)
    const riga = await prisma.fIR.findUniqueOrThrow({ where: { id } })
    expect(riga.bloccatoInvio).toBe(true)
    expect(riga.importSource).toBe('WINWASTE')
  })

  it("Q5: un FIR riacquisito da RENTRI nasce legato e NON e' un import: non e' bloccato", async () => {
    const az = await azienda('AUTOMATICA')
    const nuovo = FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      tenantId: az.tenantId,
      creatoDaUserId: az.userId,
    })
    nuovo.agganciaFormularioAcquisito(`RENTRI-Q5-${seme}`)
    await repo.save(nuovo)

    const riga = await prisma.fIR.findUniqueOrThrow({ where: { id: nuovo.id } })
    expect(riga.rentriNumeroFir).toBe(`RENTRI-Q5-${seme}`)
    expect(riga.importSource).toBeNull()
    expect(riga.bloccatoInvio).toBe(false)
    expect(riga.motivoBloccoInvio).toBeNull()
    expect((await repo.findById(nuovo.id))!.bloccatoInvio).toBe(false)
  })
})
