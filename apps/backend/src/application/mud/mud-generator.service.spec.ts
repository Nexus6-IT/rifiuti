import { MUDGeneratorService } from './mud-generator.service'
import type { MudAggregato } from './aggregazione/mud-aggregazione.service'
import { controlliMud, riepilogaAvvisi } from './aggregazione/mud-controlli'
import { INTEGRAZIONI_VUOTE } from './aggregazione/mud-integrazioni'
import type { LoggerService } from '../../core/logger/logger.service'

/**
 * Il riepilogo del MUD parte dalla stessa aggregazione dell'export: stesse righe per CER,
 * stessa finestra di date, stessi controlli.
 */
describe('MUDGeneratorService', () => {
  let aggregazione: { aggrega: jest.Mock }
  let service: MUDGeneratorService

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService

  const aggregato = (parziale: Partial<MudAggregato>): MudAggregato => ({
    anno: 2025,
    righe: [],
    movimentiPerCer: {},
    pericolosiPerCer: {},
    dichiarante: { atecoNormalizzato: '43.11.00', comuneCode: '058091' },
    controlli: [],
    mudNonDovuto: false,
    integrazioni: INTEGRAZIONI_VUOTE,
    versioneCalcolo: 2,
    dichiarazioni: [],
    ...parziale,
  })

  beforeEach(() => {
    aggregazione = { aggrega: jest.fn() }
    service = new MUDGeneratorService(aggregazione as any, logger)
  })

  it('usa la stessa aggregazione dell export, per tenant e anno', async () => {
    aggregazione.aggrega.mockResolvedValue(
      aggregato({
        righe: [
          {
            cerCode: '170405',
            prodottoKg: 1700,
            recuperoKg: 2000,
            smaltimentoKg: 500,
            dr: [],
            te: [],
          },
          { cerCode: '150101', prodottoKg: 300, recuperoKg: 0, smaltimentoKg: 0, dr: [], te: [] },
        ],
        movimentiPerCer: { '170405': 4, '150101': 1 },
        pericolosiPerCer: { '170405': true },
      })
    )
    const r = await service.generateMUDReport('t1', 2025)
    expect(aggregazione.aggrega).toHaveBeenCalledWith('t1', 2025)
    // CER come lo legge l'utente: forma canonica, con l'asterisco se pericoloso
    expect(r.wasteProduced).toEqual([
      { cerCode: '17 04 05*', totalQuantity: 1700, count: 4 },
      { cerCode: '15 01 01', totalQuantity: 300, count: 1 },
    ])
    expect(r.totals).toEqual({ produced: 2000, recovery: 2000, disposal: 500, recyclingRate: 0.8 })
    expect(r.year).toBe(2025)
    expect(r.tenantId).toBe('t1')
    expect(r.mudNonDovuto).toBe(false)
  })

  it('anno vuoto: riepilogo a zero con il controllo', async () => {
    aggregazione.aggrega.mockResolvedValue(
      aggregato({ controlli: [controlliMud.nessunMovimento(2025)] })
    )
    const r = await service.generateMUDReport('t1', 2025)
    expect(r.totals).toEqual({ produced: 0, recovery: 0, disposal: 0, recyclingRate: 0 })
    expect(r.controlli).toEqual([controlliMud.nessunMovimento(2025)])
    expect(r.riepilogoAvvisi).toEqual(riepilogaAvvisi([controlliMud.nessunMovimento(2025)]))
  })

  it('azienda non tenuta al MUD: il riepilogo lo dice', async () => {
    aggregazione.aggrega.mockResolvedValue(
      aggregato({ mudNonDovuto: true, controlli: [controlliMud.mudNonDovuto('esonero')] })
    )
    const r = await service.generateMUDReport('t1', 2025)
    expect(r.mudNonDovuto).toBe(true)
  })
})
