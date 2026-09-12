import { RaccogliAndamentoMensileUseCase } from './raccogli-andamento-mensile.use-case'

const TENANT = 'tenant-uuid-001'

// "Oggi" fisso per rendere il test deterministico: i bucket attesi vanno da
// 2025-10 a 2026-09 (12 mesi, l'ultimo è il mese di "oggi").
const OGGI = new Date(Date.UTC(2026, 8, 15)) // 15 settembre 2026

function buildPrisma(righe: Array<{ mese: Date; conteggio: number }> = []) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(righe),
  }
}

describe('RaccogliAndamentoMensileUseCase', () => {
  it('restituisce 12 mesi consecutivi terminanti nel mese corrente, a zero dove non ci sono dati', async () => {
    const prisma = buildPrisma([])
    const useCase = new RaccogliAndamentoMensileUseCase(prisma as any)

    const risultato = await useCase.raccogli(TENANT, OGGI)

    expect(risultato.mesi).toHaveLength(12)
    expect(risultato.mesi[0].mese).toBe('2025-10')
    expect(risultato.mesi[11].mese).toBe('2026-09')
    expect(risultato.mesi.every(m => m.conteggio === 0)).toBe(true)
  })

  it('riporta il conteggio del mese nella posizione corretta', async () => {
    const prisma = buildPrisma([
      { mese: new Date(Date.UTC(2026, 8, 1)), conteggio: 7 },
      { mese: new Date(Date.UTC(2026, 5, 1)), conteggio: 3 },
    ])
    const useCase = new RaccogliAndamentoMensileUseCase(prisma as any)

    const risultato = await useCase.raccogli(TENANT, OGGI)

    const settembre = risultato.mesi.find(m => m.mese === '2026-09')
    const giugno = risultato.mesi.find(m => m.mese === '2026-06')
    expect(settembre?.conteggio).toBe(7)
    expect(giugno?.conteggio).toBe(3)
  })

  it('isola per tenant: interroga con il tenantId del chiamante', async () => {
    const prisma = buildPrisma([])
    const useCase = new RaccogliAndamentoMensileUseCase(prisma as any)

    await useCase.raccogli(TENANT, OGGI)

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    const values = (prisma.$queryRaw as jest.Mock).mock.calls[0].slice(1)
    expect(values).toContain(TENANT)
  })
})
