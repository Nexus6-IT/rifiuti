import {
  aggiornaReportData,
  comunicazioneSostituita,
  dataComunicazioneSostituita,
  sostituzioneNonCoincide,
} from './mud-report-data'

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

describe('comunicazioneSostituita (G2: progressivi presentati da conservare)', () => {
  const data = new Date('2026-06-30T10:00:00Z')
  const sub = (reportData: unknown) => ({
    status: 'SUBMITTED' as const,
    submittedAt: data,
    reportData,
  })

  it('presentazione v2 con i pacchetti 1 e 2: sostituiti {1, 2}', () => {
    expect(comunicazioneSostituita(sub({ progressiviUnitaLocale: [1, 2] }))).toEqual({
      data,
      progressivi: [1, 2],
    })
  })

  it('pacchetto unico con progressivo 2: sostituito {2}', () => {
    expect(comunicazioneSostituita(sub({ progressiviUnitaLocale: [2] }))?.progressivi).toEqual([2])
  })

  it.each([
    ['presentazione senza la chiave (v1 o registrata senza file)', {}],
    ['progressivi vuoti', { progressiviUnitaLocale: [] }],
    ['progressivi di forma inattesa', { progressiviUnitaLocale: ['a', 0, 1.5] }],
    ['reportData non oggetto', null],
  ])('ripiego {1}: %s', (_n, reportData) => {
    expect(comunicazioneSostituita(sub(reportData))?.progressivi).toEqual([1])
  })

  it('annullata per sostituirla: i progressivi vengono dalla voce di annullamento', () => {
    const r = comunicazioneSostituita({
      status: 'DRAFT',
      submittedAt: null,
      reportData: {
        annullamenti: [
          {
            motivo: 'DICHIARAZIONE_DA_SOSTITUIRE',
            submittedAt: data.toISOString(),
            progressiviUnitaLocale: [2, 3],
          },
        ],
      },
    })
    expect(r).toEqual({ data, progressivi: [2, 3] })
  })

  it('annullamento senza progressivi (storico precedente): {1}', () => {
    const r = comunicazioneSostituita({
      status: 'DRAFT',
      submittedAt: null,
      reportData: {
        annullamenti: [{ motivo: 'DICHIARAZIONE_DA_SOSTITUIRE', submittedAt: data.toISOString() }],
      },
    })
    expect(r?.progressivi).toEqual([1])
  })

  it('nessuna presentazione: null, e dataComunicazioneSostituita ne segue la data', () => {
    expect(comunicazioneSostituita(null)).toBeNull()
    expect(
      comunicazioneSostituita({ status: 'DRAFT', submittedAt: null, reportData: {} })
    ).toBeNull()
    expect(dataComunicazioneSostituita(sub({ progressiviUnitaLocale: [2] }))).toEqual(data)
  })
})

describe('sostituzioneNonCoincide', () => {
  it.each([
    [[1, 2], [1, 2], false],
    [[1], [1], false],
    [[2], [2], false],
    [[1], [1, 2], true],
    [[2], [1], true],
    [[1, 2], [1], true],
    [[1, 2], [2, 3], true],
  ])('sostituiti %j, file %j → %s', (sostituiti, file, atteso) => {
    expect(sostituzioneNonCoincide(sostituiti, file)).toBe(atteso)
  })
})
