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
  let prisma: { mUDReport: { findUnique: jest.Mock } }
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
    prisma = { mUDReport: { findUnique: jest.fn().mockResolvedValue(null) } }
    service = new MUDGeneratorService(aggregazione as any, logger, prisma as any)
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
      {
        cerCode: '17 04 05*',
        totalQuantity: 1700,
        count: 4,
        recoveryKg: 2000,
        disposalKg: 500,
        giacenzaRecuperoKg: 0,
        giacenzaSmaltimentoKg: 0,
      },
      {
        cerCode: '15 01 01',
        totalQuantity: 300,
        count: 1,
        recoveryKg: 0,
        disposalKg: 0,
        giacenzaRecuperoKg: 0,
        giacenzaSmaltimentoKg: 0,
      },
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
  describe('riepilogo per unità locale (D15, D22)', () => {
    const dichiarazione = (
      codice: string,
      denominazione: string,
      righe: MudAggregato['righe'],
      movimentiPerCer: Record<string, number>,
      pericolosiPerCer: Record<string, true> = {}
    ): MudAggregato['dichiarazioni'][number] => ({
      codice,
      progressivo: Number(codice),
      unitaLocale: {
        id: `ul-${Number(codice)}`,
        denominazione,
        numIscrSito: null,
        principale: false,
      },
      anagrafica: null,
      numeroAddetti: 0,
      comuneCode: null,
      conAutorizzazioni: false,
      conAllegatiAzienda: false,
      righe,
      movimentiPerCer,
      pericolosiPerCer,
    })
    // sede 1: 17 04 05 prodotto 500, recupero 200, giacenza 300 a recupero
    // sede 2: 17 04 05 prodotto 300, smaltimento 100, giacenza 200 a smaltimento;
    //         16 02 13* prodotto 50, giacenza 50 a smaltimento
    const dueSedi = () => {
      const d1 = dichiarazione(
        '000000000000001',
        'Sede',
        [
          {
            cerCode: '170405',
            prodottoKg: 500,
            recuperoKg: 200,
            smaltimentoKg: 0,
            giacenzaRecuperoKg: 300,
          },
        ],
        { '170405': 2 }
      )
      const d2 = dichiarazione(
        '000000000000002',
        'Deposito',
        [
          {
            cerCode: '160213',
            prodottoKg: 50,
            recuperoKg: 0,
            smaltimentoKg: 0,
            giacenzaSmaltimentoKg: 50,
          },
          {
            cerCode: '170405',
            prodottoKg: 300,
            recuperoKg: 0,
            smaltimentoKg: 100,
            giacenzaSmaltimentoKg: 200,
          },
        ],
        { '160213': 1, '170405': 2 },
        { '160213': true }
      )
      return aggregato({
        righe: [...d1.righe, ...d2.righe],
        dichiarazioni: [d1, d2],
        movimentiPerCer: { '170405': 4, '160213': 1 },
        pericolosiPerCer: { '160213': true },
      })
    }

    it('riepilogo: due sedi, totali in testa uguali alla somma', async () => {
      aggregazione.aggrega.mockResolvedValue(dueSedi())
      const r = await service.generateMUDReport('t1', 2025)
      expect(r.dichiarazioni.map(d => d.codice)).toEqual(['000000000000001', '000000000000002'])
      expect(r.dichiarazioni[1].unitaLocale.denominazione).toBe('Deposito')
      expect(r.totals).toEqual({
        produced: 850,
        recovery: 200,
        disposal: 100,
        recyclingRate: 200 / 300,
      })
      expect(r.wasteProduced).toEqual([
        {
          cerCode: '16 02 13*',
          totalQuantity: 50,
          count: 1,
          recoveryKg: 0,
          disposalKg: 0,
          giacenzaRecuperoKg: 0,
          giacenzaSmaltimentoKg: 50,
        },
        {
          cerCode: '17 04 05',
          totalQuantity: 800,
          count: 4,
          recoveryKg: 200,
          disposalKg: 100,
          giacenzaRecuperoKg: 300,
          giacenzaSmaltimentoKg: 200,
        },
      ])
      expect(r.versioneCalcolo).toBe(2)
    })

    it('riepilogo: una sede, wasteProduced come oggi più recupero, smaltimento e giacenze', async () => {
      aggregazione.aggrega.mockResolvedValue(
        aggregato({
          righe: [
            {
              cerCode: '170405',
              prodottoKg: 1700,
              recuperoKg: 2000,
              smaltimentoKg: 500,
              giacenzaRecuperoKg: 120,
            },
          ],
          movimentiPerCer: { '170405': 4 },
          pericolosiPerCer: { '170405': true },
          dichiarazioni: [
            dichiarazione(
              '000000000000001',
              'Sede',
              [
                {
                  cerCode: '170405',
                  prodottoKg: 1700,
                  recuperoKg: 2000,
                  smaltimentoKg: 500,
                  giacenzaRecuperoKg: 120,
                },
              ],
              { '170405': 4 },
              { '170405': true }
            ),
          ],
        })
      )
      const r = await service.generateMUDReport('t1', 2025)
      // le tre chiavi di sempre, con gli stessi valori
      expect(
        r.wasteProduced.map(({ cerCode, totalQuantity, count }) => ({
          cerCode,
          totalQuantity,
          count,
        }))
      ).toEqual([{ cerCode: '17 04 05*', totalQuantity: 1700, count: 4 }])
      expect(r.wasteProduced[0]).toMatchObject({
        recoveryKg: 2000,
        disposalKg: 500,
        giacenzaRecuperoKg: 120,
        giacenzaSmaltimentoKg: 0,
      })
      expect(r.dichiarazioni).toHaveLength(1)
    })

    it('totaliAnno restituisce gli stessi numeri del riepilogo', async () => {
      aggregazione.aggrega.mockResolvedValue(dueSedi())
      const r = await service.generateMUDReport('t1', 2025)
      const t = await service.totaliAnno('t1', 2025)
      expect(t.anno).toBe(2025)
      expect(t.totali.prodottoKg).toBe(r.totals.produced)
      expect(t.totali.recuperoKg).toBe(r.totals.recovery)
      expect(t.totali.smaltimentoKg).toBe(r.totals.disposal)
      expect(t.perCer.map(v => [v.cerCode, v.prodottoKg, v.movimenti])).toEqual(
        r.wasteProduced.map(v => [v.cerCode, v.totalQuantity, v.count])
      )
      expect(t.dichiarazioni).toEqual(r.dichiarazioni)
      expect(aggregazione.aggrega).toHaveBeenLastCalledWith('t1', 2025)
    })

    describe('avviso SOSTITUTIVA_PIU_DICHIARAZIONI nei controlli del riepilogo (G1)', () => {
      const presentata = (reportData: unknown) =>
        prisma.mUDReport.findUnique.mockResolvedValue({
          status: 'SUBMITTED',
          submittedAt: new Date('2026-06-30T10:00:00Z'),
          reportData,
        })
      const riepilogo = async () => {
        aggregazione.aggrega.mockResolvedValue(dueSedi())
        return service.generateMUDReport('t1', 2025)
      }

      it("presentazione v1 (insieme {1}) e file con 1 e 2: l'avviso compare, con la stessa condizione dell'export", async () => {
        presentata({})
        const r = await riepilogo()
        const avviso = r.controlli.find(c => c.codice === 'SOSTITUTIVA_PIU_DICHIARAZIONI')
        expect(avviso?.messaggio).toContain('già presentate (1),')
        expect(r.riepilogoAvvisi.voci.map(v => v.codice)).toContain('SOSTITUTIVA_PIU_DICHIARAZIONI')
      })

      it('presentazione con 1 e 2: nessun avviso', async () => {
        presentata({ progressiviUnitaLocale: [1, 2], versioneCalcolo: 2 })
        const r = await riepilogo()
        expect(r.controlli.map(c => c.codice)).not.toContain('SOSTITUTIVA_PIU_DICHIARAZIONI')
      })

      it('nessuna presentazione: nessun avviso', async () => {
        const r = await riepilogo()
        expect(r.controlli.map(c => c.codice)).not.toContain('SOSTITUTIVA_PIU_DICHIARAZIONI')
      })

      it('annullata per sostituirla con insieme {2}: avviso con 2', async () => {
        prisma.mUDReport.findUnique.mockResolvedValue({
          status: 'DRAFT',
          submittedAt: null,
          reportData: {
            annullamenti: [
              {
                motivo: 'DICHIARAZIONE_DA_SOSTITUIRE',
                submittedAt: '2026-06-30T10:00:00.000Z',
                progressiviUnitaLocale: [2],
              },
            ],
          },
        })
        const r = await riepilogo()
        const avviso = r.controlli.find(c => c.codice === 'SOSTITUTIVA_PIU_DICHIARAZIONI')
        expect(avviso?.messaggio).toContain('già presentate (2),')
      })
    })

    describe('versionePresentata', () => {
      const conRecord = (status: string, reportData: unknown) =>
        prisma.mUDReport.findUnique.mockResolvedValue({ status, reportData })
      const versionePresentata = async () => {
        aggregazione.aggrega.mockResolvedValue(dueSedi())
        return (await service.generateMUDReport('t1', 2025)).versionePresentata
      }

      it('riepilogo: versionePresentata solo per un anno presentato con una versione diversa', async () => {
        // nessun record, bozza, in revisione: null
        expect(await versionePresentata()).toBeNull()
        conRecord('DRAFT', { versioneCalcolo: 1 })
        expect(await versionePresentata()).toBeNull()
        conRecord('REVIEWING', { versioneCalcolo: 1 })
        expect(await versionePresentata()).toBeNull()
        // presentato prima di F2-8 (versione assente o 1): 1
        conRecord('SUBMITTED', {})
        expect(await versionePresentata()).toBe(1)
        conRecord('SUBMITTED', { versioneCalcolo: 1 })
        expect(await versionePresentata()).toBe(1)
        conRecord('ARCHIVED', { versioneCalcolo: 1 })
        expect(await versionePresentata()).toBe(1)
        // presentato con la versione attuale: null
        conRecord('SUBMITTED', { versioneCalcolo: 2 })
        expect(await versionePresentata()).toBeNull()
        // valore fuori dall'elenco vale 1
        conRecord('SUBMITTED', { versioneCalcolo: 7 })
        expect(await versionePresentata()).toBe(1)
      })
    })
  })
})
