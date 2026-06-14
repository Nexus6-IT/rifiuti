import { MudExportService } from './mud-export.service'
import { MudVersionRegistry } from './mud-version.registry'

describe('MudExportService', () => {
  let service: MudExportService
  let prisma: any
  let mudGenerator: any
  let referenceData: any
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    prisma = { tenant: { findUnique: jest.fn() } }
    mudGenerator = { generateMUDReport: jest.fn() }
    referenceData = { findComuneByName: jest.fn().mockResolvedValue({ code: '058091' }) }
    service = new MudExportService(prisma, mudGenerator, new MudVersionRegistry(), referenceData, logger)
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
    mudGenerator.generateMUDReport.mockResolvedValue({
      wasteProduced: [{ cerCode: '150101', totalQuantity: 100, count: 2 }],
    })

    const result = await service.exportTelematico('tenant-1', 2024)

    expect(result.version).toBe('6.04/24')
    expect(result.year).toBe(2024)
    expect(result.filename).toBe('MUD_2024_12345678901.txt')
    expect(result.content).toContain('XX;')
    expect(result.content).toContain('150101')
    // ATECO e codice ISTAT comune (risolto dalle reference table) nel record AA
    expect(result.content).toContain('381100')
    expect(result.content).toContain('058091')
    expect(referenceData.findComuneByName).toHaveBeenCalledWith('Roma', 'RM')
    expect(mudGenerator.generateMUDReport).toHaveBeenCalledWith('tenant-1', 2024)
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
