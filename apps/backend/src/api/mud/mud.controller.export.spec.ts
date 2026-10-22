import { MudController } from './mud.controller'

describe('MudController.exportTelematico', () => {
  it('passa utente e avvisi confermati al servizio', async () => {
    const mudExport = {
      exportTelematico: jest
        .fn()
        .mockResolvedValue({ filename: 'f', version: '6.04/25', content: 'XX;' }),
    }
    const controller = new MudController({} as any, mudExport as any)
    const res: any = { setHeader: jest.fn(), send: jest.fn() }
    await controller.exportTelematico(
      { user: { id: 'u1', tenantId: 't1', role: 'ADMIN' } } as any,
      res,
      '2025',
      ' SCARICO_SENZA_FIR,GIACENZE_NON_CALCOLATE ,'
    )
    expect(mudExport.exportTelematico).toHaveBeenCalledWith(
      't1',
      2025,
      { id: 'u1', role: 'ADMIN' },
      ['SCARICO_SENZA_FIR', 'GIACENZE_NON_CALCOLATE']
    )
    expect(res.send).toHaveBeenCalledWith('XX;')
  })

  it('senza il parametro passa un elenco vuoto', async () => {
    const mudExport = {
      exportTelematico: jest
        .fn()
        .mockResolvedValue({ filename: 'f', version: '6.04/25', content: 'XX;' }),
    }
    const controller = new MudController({} as any, mudExport as any)
    const res: any = { setHeader: jest.fn(), send: jest.fn() }
    await controller.exportTelematico(
      { user: { id: 'u9', tenantId: 't1', role: 'VIEWER' } } as any,
      res,
      '2025'
    )
    expect(mudExport.exportTelematico).toHaveBeenCalledWith(
      't1',
      2025,
      { id: 'u9', role: 'VIEWER' },
      []
    )
  })

  it('il parametro ripetuto nella query arriva come array e vale come elenco', async () => {
    const mudExport = {
      exportTelematico: jest
        .fn()
        .mockResolvedValue({ filename: 'f', version: '6.04/25', content: 'XX;' }),
    }
    const controller = new MudController({} as any, mudExport as any)
    const res: any = { setHeader: jest.fn(), send: jest.fn() }
    // ?avvisiConfermati=A&avvisiConfermati=B,C : Express passa un array
    await controller.exportTelematico(
      { user: { id: 'u1', tenantId: 't1', role: 'ADMIN' } } as any,
      res,
      '2025',
      ['SCARICO_SENZA_FIR', 'GIACENZE_NON_CALCOLATE, FIR_ANNULLATO'] as any
    )
    expect(mudExport.exportTelematico).toHaveBeenCalledWith(
      't1',
      2025,
      { id: 'u1', role: 'ADMIN' },
      ['SCARICO_SENZA_FIR', 'GIACENZE_NON_CALCOLATE', 'FIR_ANNULLATO']
    )
  })
})
