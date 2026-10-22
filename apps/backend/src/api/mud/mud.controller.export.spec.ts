import { ForbiddenException } from '@nestjs/common'
import { MudController } from './mud.controller'
import { MudExportService } from '../../application/mud/export/mud-export.service'
import { MudVersionRegistry } from '../../application/mud/export/mud-version.registry'
import { controlliMud, type RifMovimento } from '../../application/mud/aggregazione/mud-controlli'

/** Risoluzione del ruolo effettivo finta: restituisce sempre il ruolo indicato. */
const ruoli = (ruolo: string) => ({ ruoloEffettivo: jest.fn().mockResolvedValue(ruolo) })

describe('MudController.exportTelematico', () => {
  it('passa utente e avvisi confermati al servizio', async () => {
    const mudExport = {
      exportTelematico: jest
        .fn()
        .mockResolvedValue({ filename: 'f', version: '6.04/25', content: 'XX;' }),
    }
    const controller = new MudController(
      {} as any,
      mudExport as any,
      ruoli('ADMIN') as any,
      {} as any
    )
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
    const controller = new MudController(
      {} as any,
      mudExport as any,
      ruoli('ADMIN') as any,
      {} as any
    )
    const res: any = { setHeader: jest.fn(), send: jest.fn() }
    await controller.exportTelematico(
      { user: { id: 'u9', tenantId: 't1', role: 'VIEWER' } } as any,
      res,
      '2025'
    )
    expect(mudExport.exportTelematico).toHaveBeenCalledWith(
      't1',
      2025,
      { id: 'u9', role: 'ADMIN' },
      []
    )
  })

  it('il parametro ripetuto nella query arriva come array e vale come elenco', async () => {
    const mudExport = {
      exportTelematico: jest
        .fn()
        .mockResolvedValue({ filename: 'f', version: '6.04/25', content: 'XX;' }),
    }
    const controller = new MudController(
      {} as any,
      mudExport as any,
      ruoli('ADMIN') as any,
      {} as any
    )
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

  it('passa al servizio il ruolo effettivo, non quello del token', async () => {
    const mudExport = {
      exportTelematico: jest
        .fn()
        .mockResolvedValue({ filename: 'f', version: '6.04/25', content: 'XX;' }),
    }
    const membership = ruoli('VIEWER')
    const controller = new MudController({} as any, mudExport as any, membership as any, {} as any)
    const req = { tenantId: 'cliente', user: { id: 'u1', tenantId: 'studio', role: 'ADMIN' } }
    const res: any = { setHeader: jest.fn(), send: jest.fn() }
    await controller.exportTelematico(req as any, res, '2025')

    // il ruolo si risolve sull'azienda selezionata, non su quella del token
    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'cliente')
    expect(mudExport.exportTelematico).toHaveBeenCalledWith(
      'cliente',
      2025,
      { id: 'u1', role: 'VIEWER' },
      []
    )
  })

  it("un consulente con ruolo di sola consultazione nell'azienda selezionata riceve 403", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ ragioneSociale: 'Cliente Srl' }) },
      mUDReport: { findUnique: jest.fn(), upsert: jest.fn() },
      $transaction: jest.fn(),
    }
    const rifMovimento: RifMovimento = {
      progressiveNumber: 7,
      progressiveYear: 2024,
      cerCode: '170405',
      causale: 'SCARICO',
      quantity: 100,
      unit: 'kg',
    }
    const aggregazione = {
      aggrega: jest.fn().mockResolvedValue({
        anno: 2024,
        righe: [],
        dichiarante: { atecoNormalizzato: '381100', comuneCode: '058091' },
        movimentiPerCer: {},
        controlli: [controlliMud.firAnnullato(rifMovimento, 'ABC 123')],
      }),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const servizio = new MudExportService(
      prisma,
      new MudVersionRegistry(),
      aggregazione as any,
      logger
    )
    const controller = new MudController({} as any, servizio, ruoli('VIEWER') as any, {} as any)
    const res: any = { setHeader: jest.fn(), send: jest.fn() }

    // ADMIN del proprio studio (ruolo del token), ma nell'azienda del cliente ha un ruolo di
    // sola consultazione: non conferma un avviso che toglie quantità dalla dichiarazione.
    const errore = await controller
      .exportTelematico(
        { tenantId: 'cliente', user: { id: 'u1', tenantId: 'studio', role: 'ADMIN' } } as any,
        res,
        '2024',
        'FIR_ANNULLATO'
      )
      .catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse().error).toBe('MUD_CONFERMA_RISERVATA_AMMINISTRATORI')
    expect(aggregazione.aggrega).toHaveBeenCalledWith('cliente', 2024)
    expect(res.send).not.toHaveBeenCalled()
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
  })
})
