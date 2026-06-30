import { MudExportService } from './mud-export.service'
import { MudVersionRegistry } from './mud-version.registry'

describe('MudExportService', () => {
  let service: MudExportService
  let prisma: any
  let referenceData: any
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      fIR: { findMany: jest.fn().mockResolvedValue([]) },
      destinatario: { findMany: jest.fn().mockResolvedValue([]) },
    }
    referenceData = { findComuneByName: jest.fn().mockResolvedValue({ code: '058091' }) }
    service = new MudExportService(prisma, new MudVersionRegistry(), referenceData, logger)
  })

  it('genera il file MUD della versione corretta per anno', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      ragioneSociale: 'Acme Spa',
      partitaIva: '12345678901',
      codiceFiscale: '12345678901',
      address: 'Via Roma 1',
      civico: '10',
      city: 'Roma',
      province: 'RM',
      postalCode: '00100',
      pec: 'acme@pec.it',
      telefono: '0612345678',
      atecoCode: '381100',
      reaNumber: '123456',
      numeroAddetti: 42,
      legaleRappresentanteNome: 'Mario',
      legaleRappresentanteCognome: 'Rossi',
    })
    // metallo ferroso 170405: 80 a recupero (al destinatario D1, trasportato da T1),
    // 20 a smaltimento (destinatario D1).
    prisma.fIR.findMany.mockResolvedValue([
      {
        cerCode: '170405',
        quantity: 80,
        wasteOperationType: 'RECOVERY',
        carrierId: 'car-1',
        carrierName: 'Trasporti Srl',
        carrierPartitaIva: '22222222222',
        receiverId: 'dest-1',
        receiverName: 'Recupero Metalli Srl',
        receiverPartitaIva: '33333333333',
      },
      {
        cerCode: '170405',
        quantity: 20,
        wasteOperationType: 'DISPOSAL',
        carrierId: 'car-1',
        carrierName: 'Trasporti Srl',
        carrierPartitaIva: '22222222222',
        receiverId: 'dest-1',
        receiverName: 'Recupero Metalli Srl',
        receiverPartitaIva: '33333333333',
      },
    ])
    prisma.destinatario.findMany.mockResolvedValue([
      {
        id: 'dest-1',
        ragioneSociale: 'Recupero Metalli Srl',
        partitaIVA: '33333333333',
        via: 'Via Industria',
        civico: '5',
        cap: '20100',
        comune: 'Milano',
        provincia: 'MI',
      },
    ])

    const result = await service.exportTelematico('tenant-1', 2024)

    expect(result.version).toBe('6.04/24')
    expect(result.filename).toBe('MUD_2024_12345678901.txt')
    expect(result.content).toContain(';170405;')
    expect(result.content).toContain('0000100,000') // prodotto = 100
    expect(result.content).toContain('0000080,000') // recupero
    expect(result.content).toContain('0000020,000') // smaltimento
    // ATECO + ISTAT provincia(3)+comune(3) dichiarante nel record AA
    expect(result.content).toContain('381100')
    expect(result.content).toContain(';058;091;')

    const lines = result.content.trim().split('\r\n')
    // AA contiene REA, addetti, legale rappresentante e mantiene la lunghezza 338
    const aa = lines.find(l => l.startsWith('AA;'))!
    expect(aa.length).toBe(338)
    expect(aa).toContain('000123456') // REA (9)
    expect(aa).toContain('00042') // addetti (5)
    expect(aa).toContain('ROSSI')
    expect(aa).toContain('MARIO')
    // modulo BB DR (destinatario) e TE (trasportatore)
    const dr = lines.find(l => l.startsWith('BB;') && l.includes(';DR;'))!
    const te = lines.find(l => l.startsWith('BB;') && l.includes(';TE;'))!
    expect(dr).toContain('RECUPERO METALLI SRL')
    expect(dr).toContain('33333333333') // CF destinatario
    expect(dr).toContain('0000100,000') // quantità conferita = 80+20
    expect(te).toContain('TRASPORTI SRL')
    expect(te).toContain('22222222222')
  })

  it('propaga errore per anno non supportato (prima di toccare il DB)', async () => {
    await expect(service.exportTelematico('tenant-1', 1999)).rejects.toThrow('nessun tracciato')
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled()
  })

  it('supportedVersions elenca anno/versione', () => {
    expect(service.supportedVersions()).toEqual(
      expect.arrayContaining([{ year: 2024, version: '6.04/24' }])
    )
  })
})
