import { PrismaClient, RentriNumeroVidimatoStato } from '@prisma/client'
import { FIRPrismaRepository } from './fir-prisma.repository'
import { RentriScortaRepository } from './rentri-scorta.repository'
import { FIR, FirmaDigitale } from '../../domain/fir/aggregates/fir.aggregate'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
import { eScortaRentriVuota } from '../../domain/rentri/scorta-rentri-vuota'

/**
 * Collegamento scorta vidimata -> emissione, su PostgreSQL reale: il numero dell'ente si consuma
 * DENTRO la transaction di emissione. Cio' che una finta non dimostra: due emissioni simultanee non
 * prendono lo stesso numero, e un'emissione che fallisce non brucia il numero.
 */
describe('FIRPrismaRepository.emettiConNumerazione con scorta vidimata (Postgres reale)', () => {
  let prisma: PrismaClient
  let repo: FIRPrismaRepository
  let scorta: RentriScortaRepository
  let tenantId: string
  let userId: string
  const SEDE = 'SITO-SCORTA-1'
  const BLOCCO = 'BLOCCO-A'
  const REG_P = '11111111-1111-4111-8111-111111111111'
  const REG_T = '22222222-2222-4222-8222-222222222222'
  const REG_D = '33333333-3333-4333-8333-333333333333'

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    repo = new FIRPrismaRepository(Object.assign(prisma, { db: prisma }) as any, prisma as any)
    scorta = new RentriScortaRepository(prisma as any)
    const tenant = await prisma.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Scorta Emissione SRL',
        country: 'IT',
      },
    })
    tenantId = tenant.id
    const user = await prisma.user.create({
      data: {
        tenantId,
        keycloakId: `keycloak-se-${Date.now()}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `se-${Date.now()}@example.com`,
        role: 'OPERATOR',
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    if (!tenantId) return
    await prisma.rentriNumeroVidimato.deleteMany({ where: { tenantId } })
    await prisma.fIR.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await cancellaAziendeDiProva(prisma, tenantId)
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.rentriNumeroVidimato.deleteMany({ where: { tenantId } })
  })

  const firma = (): FirmaDigitale => ({
    firmatario: 'Mario Rossi',
    timestamp: new Date(),
    certificato: 'x',
    userId,
  })

  async function bozza(): Promise<FIR> {
    const fir = FIR.create({
      produttoreId: REG_P,
      rifiuto: { cerCode: '150101', quantita: 100 },
      trasportatoreId: REG_T,
      destinatarioId: REG_D,
      tenantId,
      creatoDaUserId: userId,
    })
    await repo.save(fir)
    return fir
  }

  async function seed(n: number, sede = SEDE, blocco = BLOCCO): Promise<void> {
    for (let progressivo = 1; progressivo <= n; progressivo++) {
      await scorta.inserisciDisponibile(tenantId, {
        numIscrSito: sede,
        codiceBlocco: blocco,
        progressivo,
        numeroFir: `BCDFG ${String(progressivo).padStart(6, '0')} L`,
        qrCodeBytes: 'cXI=',
        dataVidimazione: new Date(),
      })
    }
  }

  const opzioni = { numeroVidimato: { numIscrSito: SEDE } }

  it('consuma il numero piu basso della scorta e lo lega al FIR emesso', async () => {
    await seed(3)
    const f = await bozza()
    await repo.emettiConNumerazione(f, 2040, n => f.emetti(n, firma()), opzioni)

    const usato = await scorta.trovaConsumatoDaFir(tenantId, f.id)
    expect(usato?.progressivo).toBe(1)
    expect(usato?.stato).toBe(RentriNumeroVidimatoStato.USATO)
    expect(await scorta.contaTotaleDisponibili(tenantId, SEDE)).toBe(2)
  })

  it('senza opzioni non tocca la scorta (emissione come prima)', async () => {
    await seed(1)
    const f = await bozza()
    await repo.emettiConNumerazione(f, 2041, n => f.emetti(n, firma()))
    expect(await scorta.contaTotaleDisponibili(tenantId, SEDE)).toBe(1)
  })

  it('scorta vuota: errore SCORTA_RENTRI_VUOTA e il FIR resta in bozza', async () => {
    const f = await bozza()
    const errore = await repo
      .emettiConNumerazione(f, 2042, n => f.emetti(n, firma()), opzioni)
      .catch(e => e)
    expect(eScortaRentriVuota(errore)).toBe(true)
    const riga = await prisma.fIR.findUnique({ where: { id: f.id } })
    expect(riga?.status).toBe('DRAFT')
  })

  it('rispetta il blocco richiesto e la sede: numeri di altre sedi non si toccano', async () => {
    await seed(1, 'ALTRA-SEDE', 'BLOCCO-X')
    const f = await bozza()
    await expect(
      repo.emettiConNumerazione(f, 2043, n => f.emetti(n, firma()), opzioni)
    ).rejects.toBeDefined()
    expect(await scorta.contaTotaleDisponibili(tenantId, 'ALTRA-SEDE')).toBe(1)
  })

  it('emissione fallita DOPO il consumo: il numero torna disponibile', async () => {
    await seed(1)
    const f = await bozza()
    await expect(
      repo.emettiConNumerazione(
        f,
        2044,
        () => {
          throw new Error('guasto del dominio')
        },
        opzioni
      )
    ).rejects.toThrow('guasto del dominio')
    expect(await scorta.contaTotaleDisponibili(tenantId, SEDE)).toBe(1)
    expect(await scorta.trovaConsumatoDaFir(tenantId, f.id)).toBeNull()
  })

  it('FIR gia emesso nel frattempo (corsa persa): il numero non si brucia', async () => {
    await seed(1)
    const f = await bozza()
    const copia1 = (await repo.findById(f.id))!
    const copia2 = (await repo.findById(f.id))!
    const esiti = await Promise.allSettled([
      repo.emettiConNumerazione(copia1, 2045, n => copia1.emetti(n, firma()), opzioni),
      repo.emettiConNumerazione(copia2, 2045, n => copia2.emetti(n, firma()), opzioni),
    ])
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    expect(await scorta.contaTotaleDisponibili(tenantId, SEDE)).toBe(0)
    const consumati = await prisma.rentriNumeroVidimato.count({
      where: { tenantId, stato: 'USATO', firId: f.id },
    })
    expect(consumati).toBe(1)
  })

  it('dieci emissioni simultanee su dieci numeri: tutti diversi, nessuno perso', async () => {
    await seed(10)
    const firs = await Promise.all(Array.from({ length: 10 }, () => bozza()))
    const esiti = await Promise.allSettled(
      firs.map(f => repo.emettiConNumerazione(f, 2046, n => f.emetti(n, firma()), opzioni))
    )
    expect(esiti.filter(e => e.status === 'rejected')).toHaveLength(0)

    const usati = await prisma.rentriNumeroVidimato.findMany({
      where: { tenantId, stato: 'USATO' },
    })
    expect(usati).toHaveLength(10)
    expect(new Set(usati.map(u => u.numeroFir)).size).toBe(10)
    expect(new Set(usati.map(u => u.firId)).size).toBe(10)
  })

  it('due emissioni simultanee con UN solo numero: una riesce, l altra riceve scorta vuota', async () => {
    await seed(1)
    const [x, y] = [await bozza(), await bozza()]
    const esiti = await Promise.allSettled([
      repo.emettiConNumerazione(x, 2047, n => x.emetti(n, firma()), opzioni),
      repo.emettiConNumerazione(y, 2048, n => y.emetti(n, firma()), opzioni),
    ])
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
    expect(eScortaRentriVuota(rifiutato.reason)).toBe(true)
    expect(await prisma.rentriNumeroVidimato.count({ where: { tenantId, stato: 'USATO' } })).toBe(1)
  })

  it('con piu blocchi nella sede, il blocco indicato e quello usato', async () => {
    await seed(2, SEDE, 'BLOCCO-A')
    await seed(2, SEDE, 'BLOCCO-B')
    const f = await bozza()
    await repo.emettiConNumerazione(f, 2049, n => f.emetti(n, firma()), {
      numeroVidimato: { numIscrSito: SEDE, codiceBlocco: 'BLOCCO-B' },
    })
    expect((await scorta.trovaConsumatoDaFir(tenantId, f.id))?.codiceBlocco).toBe('BLOCCO-B')
  })
})
