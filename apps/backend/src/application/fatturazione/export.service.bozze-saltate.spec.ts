// Bozze scelte in `documentoIds`: contano fra i `saltati` dell'export XML_ZIP (unit, senza database).
import { randomUUID } from 'node:crypto'
import { TenantContext } from '../../core/context/tenant-context'
import type { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { ExportService } from './export.service'

describe('ExportService.esporta XML_ZIP: bozze scelte fra i saltati', () => {
  const tenantId = randomUUID()
  const idDefinitivo = randomUUID()

  function crea(opzioni: { bozze: number; righe: string[] }) {
    const interrogazioni: string[] = []
    const tx = {
      // Ordine in `seleziona`: conteggio, conteggio bozze (solo con documentoIds), righe.
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const testo = strings.join('?')
        interrogazioni.push(testo)
        if (testo.includes('AS n ')) return [{ n: opzioni.bozze }]
        if (testo.includes('AS totale')) return [{ totale: opzioni.righe.length }]
        return opzioni.righe.map(id => ({ id, numero: 1, anno: 2026, registroCodice: 'A' }))
      }),
      $executeRaw: jest.fn(async () => 0),
      $executeRawUnsafe: jest.fn(async () => 0),
      activityLog: { create: jest.fn(async () => ({})) },
    }
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService
    const xml = {
      zip: jest.fn(async () => ({ contenuto: Buffer.from('zip'), saltati: 1 })),
    }
    const servizio = new ExportService(prisma, {} as never, xml as never, {} as never, {} as never)
    return { servizio, xml, tx }
  }
  const esporta = (s: ExportService, documentoIds?: string[]) =>
    TenantContext.run({ tenantId }, () =>
      s.esporta(tenantId, randomUUID(), {
        formato: 'XML_ZIP',
        selezione: documentoIds ? { documentoIds } : {},
        confermaEmissione: true,
      })
    )

  it('con documentoIds somma le bozze scelte ai saltati dello zip', async () => {
    const { servizio, xml, tx } = crea({ bozze: 2, righe: [idDefinitivo] })
    const r = await esporta(servizio, [idDefinitivo, randomUUID(), randomUUID(), randomUUID()])
    expect(r.saltati).toBe(3)
    // Lo zip riceve solo i documenti non bozza.
    expect(xml.zip).toHaveBeenCalledWith(tenantId, expect.any(String), [idDefinitivo], {
      confermaEmissione: true,
    })
    expect(tx.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { formato: 'XML_ZIP', documenti: 0, saltati: 3 } }),
    })
  })

  it('senza documentoIds non conta nessuna bozza', async () => {
    const { servizio, tx } = crea({ bozze: 5, righe: [idDefinitivo] })
    const r = await esporta(servizio)
    expect(r.saltati).toBe(1)
    // Solo conteggio e righe: nessuna lettura delle bozze.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
  })
})
