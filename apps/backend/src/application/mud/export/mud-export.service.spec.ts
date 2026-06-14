import { MudExportService } from './mud-export.service'
import { MudVersionRegistry } from './mud-version.registry'

describe('MudExportService', () => {
  let service: MudExportService
  let prisma: any
  let referenceData: any
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    prisma = { tenant: { findUnique: jest.fn() }, fIR: { groupBy: jest.fn().mockResolvedValue([]) } }
    referenceData = { findComuneByName: jest.fn().mockResolvedValue({ code: '058091' }) }
    service = new MudExportService(prisma, new MudVersionRegistry(), referenceData, logger)
  })

  it('genera il file MUD della versione corretta per anno', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      ragioneSociale: 'Acme Spa',
      partitaIva: '12345678901',
      address: 'Via Roma 1',
      city: 'Roma',
      province: 'RM',
      postalCode: '00100',
      pec: 'acme@pec.it',
      atecoCode: '381100',
    })
    // metallo ferroso: 80 a recupero, 20 a smaltimento
    prisma.fIR.groupBy.mockResolvedValue([
      { cerCode: '170405', wasteOperationType: 'RECOVERY', _sum: { quantity: 80 } },
      { cerCode: '170405', wasteOperationType: 'DISPOSAL', _sum: { quantity: 20 } },
    ])

    const result = await service.exportTelematico('tenant-1', 2024)

    expect(result.version).toBe('6.04/24')
    expect(result.year).toBe(2024)
    expect(result.filename).toBe('MUD_2024_12345678901.txt')
    expect(result.content).toContain('XX;')
    expect(result.content).toContain(';170405;')
    // prodotto = recupero + smaltimento = 100
    expect(result.content).toContain('0000100,000')
    expect(result.content).toContain('0000080,000')
    expect(result.content).toContain('0000020,000')
    // ATECO e codice ISTAT comune nel record AA
    expect(result.content).toContain('381100')
    expect(result.content).toContain('058091')
    expect(referenceData.findComuneByName).toHaveBeenCalledWith('Roma', 'RM')
  })

  it('propaga errore per anno non supportato (prima di toccare il DB)', async () => {
    await expect(service.exportTelematico('tenant-1', 1999)).rejects.toThrow('nessun tracciato')
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled()
  })

  it('supportedVersions elenca anno/versione', () => {
    expect(service.supportedVersions()).toEqual(
      expect.arrayContaining([{ year: 2024, version: '6.04/24' }]),
    )
  })
})
