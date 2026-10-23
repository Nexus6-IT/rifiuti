import { aggiornaReportData } from './mud-report-data'

describe('aggiornaReportData', () => {
  let tx: any

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn(),
      mUDReport: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    }
  })

  it('prende il lock per tenant e anno prima di leggere, e conserva le altre chiavi', async () => {
    const ordine: string[] = []
    tx.$executeRaw.mockImplementation(async () => {
      ordine.push('lock')
    })
    tx.mUDReport.findUnique.mockImplementation(async () => {
      ordine.push('lettura')
      return {
        status: 'SUBMITTED',
        submittedAt: null,
        submittedBy: null,
        reportData: { hashAggregato: 'h1' },
      }
    })
    await aggiornaReportData(tx, 't1', 2025, p => ({
      reportData: { ...p, integrazioni: { x: 1 } },
    }))
    expect(ordine).toEqual(['lock', 'lettura'])
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(['mud-report|t1|2025'])
    expect(tx.mUDReport.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_year: { tenantId: 't1', year: 2025 } } })
    )
    expect(tx.mUDReport.upsert.mock.calls[0][0].update).toEqual({
      reportData: { hashAggregato: 'h1', integrazioni: { x: 1 } },
    })
  })

  it('un reportData che non è un oggetto vale come vuoto, e muta → null non scrive', async () => {
    tx.mUDReport.findUnique.mockResolvedValue({
      status: 'DRAFT',
      submittedAt: null,
      submittedBy: null,
      reportData: 'rotto',
    })
    const r = await aggiornaReportData(tx, 't1', 2025, () => null)
    expect(r).toMatchObject({ precedente: {}, scritto: false })
    expect(tx.mUDReport.upsert).not.toHaveBeenCalled()
  })

  it('con il record assente crea in DRAFT con i campi indicati, e passa i campi anche in update', async () => {
    const muta = jest.fn(() => ({
      reportData: { a: 1 },
      campi: { status: 'SUBMITTED' as const, submittedAt: new Date(0), submittedBy: 'u1' },
    }))
    const r = await aggiornaReportData(tx, 't1', 2025, muta)
    expect(muta).toHaveBeenCalledWith({}, null)
    expect(r).toEqual({ precedente: {}, record: null, scritto: true })
    expect(tx.mUDReport.upsert).toHaveBeenCalledWith({
      where: { tenantId_year: { tenantId: 't1', year: 2025 } },
      create: {
        tenantId: 't1',
        year: 2025,
        status: 'SUBMITTED',
        submittedAt: new Date(0),
        submittedBy: 'u1',
        reportData: { a: 1 },
      },
      update: {
        reportData: { a: 1 },
        status: 'SUBMITTED',
        submittedAt: new Date(0),
        submittedBy: 'u1',
      },
    })
  })

  it('senza campi il record nuovo nasce DRAFT e non presentato', async () => {
    await aggiornaReportData(tx, 't1', 2025, () => ({ reportData: { a: 1 } }))
    expect(tx.mUDReport.upsert.mock.calls[0][0].create).toEqual({
      tenantId: 't1',
      year: 2025,
      status: 'DRAFT',
      submittedAt: null,
      submittedBy: null,
      reportData: { a: 1 },
    })
  })

  it('un array in reportData vale come vuoto', async () => {
    tx.mUDReport.findUnique.mockResolvedValue({
      status: 'DRAFT',
      submittedAt: null,
      submittedBy: null,
      reportData: [1, 2],
    })
    const r = await aggiornaReportData(tx, 't1', 2025, () => null)
    expect(r.precedente).toEqual({})
  })
})
