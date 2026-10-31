import { MudAggregazioneService, type MudAggregato } from './aggregazione/mud-aggregazione.service'
import { creaPrismaFinto, type MovimentoFinto } from './aggregazione/mud-prisma-finto.fixture-spec'
import { pacchettiPerExport } from './aggregazione/mud-dichiarazioni'
import { INTEGRAZIONI_VUOTE } from './aggregazione/mud-integrazioni'
import { MudTracciatoV604_2025 } from './export/versions/mud-tracciato-v604-2025'
import { fixtureDatoCompleto } from './export/mud-tracciato-v604-legacy.fixture-spec'
import type { MudRifiutoLine } from './export/mud-export.types'
import { totaliMud } from './mud-totali'

/**
 * Totali del MUD (D22). Ogni valore atteso è scritto a mano dai movimenti dello scenario o dai
 * numeri delle righe: nessuno è ricavato dal codice sotto test.
 */
describe('totaliMud', () => {
  const sede = (denominazione: string, id: string | null = null) => ({
    id,
    denominazione,
    numIscrSito: null,
    principale: id === 'ul-1',
  })
  const dichiarazione = (
    codice: string,
    denominazione: string,
    righe: MudRifiutoLine[],
    movimentiPerCer: Record<string, number>,
    pericolosiPerCer: Record<string, true> = {}
  ): MudAggregato['dichiarazioni'][number] => ({
    codice,
    progressivo: Number(codice),
    unitaLocale: sede(denominazione, `ul-${Number(codice)}`),
    anagrafica: null,
    numeroAddetti: 0,
    comuneCode: null,
    conAutorizzazioni: false,
    conAllegatiAzienda: false,
    righe,
    movimentiPerCer,
    pericolosiPerCer,
  })
  const riga = (
    cerCode: string,
    prodottoKg: number,
    recuperoKg: number,
    smaltimentoKg: number,
    giacenzaRecuperoKg?: number,
    giacenzaSmaltimentoKg?: number
  ): MudRifiutoLine => ({
    cerCode,
    prodottoKg,
    recuperoKg,
    smaltimentoKg,
    ...(giacenzaRecuperoKg !== undefined ? { giacenzaRecuperoKg } : {}),
    ...(giacenzaSmaltimentoKg !== undefined ? { giacenzaSmaltimentoKg } : {}),
  })
  const aggregato = (
    dichiarazioni: MudAggregato['dichiarazioni'],
    parziale: Partial<MudAggregato> = {}
  ): MudAggregato => ({
    anno: 2025,
    righe: dichiarazioni.flatMap(d => d.righe),
    movimentiPerCer: {},
    pericolosiPerCer: {},
    dichiarante: { atecoNormalizzato: null, comuneCode: null },
    controlli: [],
    mudNonDovuto: false,
    integrazioni: INTEGRAZIONI_VUOTE,
    versioneCalcolo: 2,
    dichiarazioni,
    ...parziale,
  })

  const dueSedi = () =>
    aggregato([
      dichiarazione(
        '000000000000001',
        'Sede',
        [riga('170405', 500, 200, 0, 300), riga('200101', 40, 0, 0)],
        { '170405': 2, '200101': 1 }
      ),
      dichiarazione(
        '000000000000002',
        'Deposito',
        [riga('160213', 50, 0, 0, undefined, 50), riga('170405', 300, 0, 100, undefined, 200)],
        { '160213': 1, '170405': 2 },
        { '160213': true }
      ),
    ])

  it('totali di testa = somma delle dichiarazioni', () => {
    const t = totaliMud(dueSedi())
    // somme a mano: prodotto 500+40+50+300, recupero 200, smaltimento 100,
    // giacenze 300 a recupero e 50+200 a smaltimento, movimenti 2+1+1+2
    expect(t.totali).toEqual({
      prodottoKg: 890,
      recuperoKg: 200,
      smaltimentoKg: 100,
      giacenzaRecuperoKg: 300,
      giacenzaSmaltimentoKg: 250,
      movimenti: 6,
    })
    expect(t.dichiarazioni.map(d => d.codice)).toEqual(['000000000000001', '000000000000002'])
    expect(t.dichiarazioni[0].totali).toEqual({
      prodottoKg: 540,
      recuperoKg: 200,
      smaltimentoKg: 0,
      giacenzaRecuperoKg: 300,
      giacenzaSmaltimentoKg: 0,
      movimenti: 3,
    })
    expect(t.dichiarazioni[1].totali).toEqual({
      prodottoKg: 350,
      recuperoKg: 0,
      smaltimentoKg: 100,
      giacenzaRecuperoKg: 0,
      giacenzaSmaltimentoKg: 250,
      movimenti: 3,
    })
    expect(t.dichiarazioni[1].unitaLocale.denominazione).toBe('Deposito')
    expect(t.anno).toBe(2025)
  })

  it('per CER del file: lo stesso CER di due sedi sommato, asterisco se pericoloso in una delle due', () => {
    const a = dueSedi()
    // 20 01 21 pericoloso solo nella seconda sede
    a.dichiarazioni[0].righe.push(riga('200121', 10, 0, 0))
    a.dichiarazioni[0].movimentiPerCer['200121'] = 1
    a.dichiarazioni[1].righe.push(riga('200121', 5, 0, 0))
    a.dichiarazioni[1].movimentiPerCer['200121'] = 1
    a.dichiarazioni[1].pericolosiPerCer['200121'] = true
    const t = totaliMud(a)
    const per = (cer: string) => t.perCer.find(v => v.cerCode === cer)
    expect(t.perCer.map(v => v.cerCode)).toEqual(['16 02 13*', '17 04 05', '20 01 01', '20 01 21*'])
    expect(per('17 04 05')).toEqual({
      cerCode: '17 04 05',
      pericoloso: false,
      prodottoKg: 800,
      recuperoKg: 200,
      smaltimentoKg: 100,
      giacenzaRecuperoKg: 300,
      giacenzaSmaltimentoKg: 200,
      movimenti: 4,
    })
    expect(per('20 01 21*')).toMatchObject({ pericoloso: true, prodottoKg: 15, movimenti: 2 })
    // nel dettaglio della sede 1 lo stesso CER non è pericoloso
    expect(t.dichiarazioni[0].perCer.map(v => v.cerCode)).toContain('20 01 21')
    expect(t.dichiarazioni[1].perCer.map(v => v.cerCode)).toContain('20 01 21*')
  })

  it('arrotondamento al grammo', () => {
    const a = aggregato([
      dichiarazione('000000000000001', 'A', [riga('170405', 0.1, 0.2, 0, 0.0004)], {
        '170405': 1,
      }),
      dichiarazione('000000000000002', 'B', [riga('170405', 0.2, 0, 0.3, 0.0004)], {
        '170405': 1,
      }),
    ])
    const t = totaliMud(a)
    // 0,1 + 0,2 = 0,30000000000000004 in virgola mobile: al grammo fa 0,3
    expect(t.totali.prodottoKg).toBe(0.3)
    expect(t.perCer[0].prodottoKg).toBe(0.3)
    expect(t.perCer[0].recuperoKg).toBe(0.2)
    expect(t.perCer[0].smaltimentoKg).toBe(0.3)
    // 0,0004 + 0,0004 = 0,0008: sotto il grammo → 0,001
    expect(t.totali.giacenzaRecuperoKg).toBe(0.001)
    expect(t.dichiarazioni[0].totali.giacenzaRecuperoKg).toBe(0)
  })

  it('versioneCalcolo riportata', () => {
    expect(totaliMud(dueSedi()).versioneCalcolo).toBe(2)
    expect(totaliMud(aggregato([], { versioneCalcolo: 1 })).versioneCalcolo).toBe(1)
  })

  it('senza dichiarazioni vale come una sola, dalle righe', () => {
    const t = totaliMud(
      aggregato([], {
        righe: [riga('170405', 100, 100, 0), riga('150101', 7, 0, 0)],
        movimentiPerCer: { '170405': 2, '150101': 1 },
        pericolosiPerCer: { '170405': true },
      })
    )
    expect(t.perCer.map(v => v.cerCode)).toEqual(['17 04 05*', '15 01 01'])
    expect(t.totali.prodottoKg).toBe(107)
    expect(t.dichiarazioni).toHaveLength(1)
  })

  describe('contro il file e contro l aggregazione', () => {
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const referenceData: any = { findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }) }
    const mov = (p: Partial<MovimentoFinto>): MovimentoFinto => ({
      registroId: 'reg-A',
      progressiveNumber: 1,
      progressiveYear: 2025,
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      causaleAziendaId: null,
      cerCode: '17 04 05',
      quantity: 100,
      unit: 'KG',
      operationCode: null,
      firId: null,
      firIdRicopia: null,
      ricopiaChiave: '',
      counterpartName: null,
      wastePhysicalState: null,
      movementDate: new Date('2025-06-10T08:00:00Z'),
      ...p,
    })
    const giorno = (g: string) => new Date(`${g}T08:00:00Z`)

    // Due sedi (registro A sulla principale, B sul deposito).
    // Sede 1, 17 04 05: produce 500, avvia 200 a recupero (R13) → giacenza 300 a recupero.
    // Sede 2, 17 04 05: produce 300, avvia 100 a smaltimento (D15) → giacenza 200 a smaltimento;
    //   16 02 13*: produce 50, mai avviato → giacenza 50 a smaltimento.
    const movimenti: MovimentoFinto[] = [
      mov({ progressiveNumber: 1, quantity: 500 }),
      mov({
        progressiveNumber: 2,
        type: 'SCARICO',
        causale: 'AVVIO_RECUPERO',
        quantity: 200,
        operationCode: 'R13',
        counterpartName: 'Recuperi Nord Srl',
        movementDate: giorno('2025-07-01'),
      }),
      mov({
        registroId: 'reg-B',
        progressiveNumber: 1,
        quantity: 300,
        movementDate: giorno('2025-06-11'),
      }),
      mov({
        registroId: 'reg-B',
        progressiveNumber: 2,
        cerCode: '16 02 13*',
        quantity: 50,
        movementDate: giorno('2025-06-12'),
      }),
      mov({
        registroId: 'reg-B',
        progressiveNumber: 3,
        type: 'SCARICO',
        causale: 'AVVIO_SMALTIMENTO',
        quantity: 100,
        operationCode: 'D15',
        counterpartName: 'Discarica Sud Srl',
        movementDate: giorno('2025-08-01'),
      }),
    ]
    const dati = {
      movimenti,
      unitaLocali: [
        { denominazione: 'Sede', numIscrSito: 'OP1', principale: true },
        { denominazione: 'Deposito', numIscrSito: 'OP2', principale: false },
      ],
      registri: [
        { id: 'reg-A', descrizione: 'Registro A', unitaLocaleId: 'ul-1' },
        { id: 'reg-B', descrizione: 'Registro B', unitaLocaleId: 'ul-2' },
      ],
    }
    const aggrega = () =>
      new MudAggregazioneService(creaPrismaFinto(dati), referenceData, logger).aggrega('t1', 2025)

    it('prodotto uguale all aggregazione MUD sugli stessi movimenti', async () => {
      const a = await aggrega()
      const t = totaliMud(a)
      // valori attesi a mano dai movimenti dello scenario
      expect(t.totali.prodottoKg).toBe(850) // 500 + 300 + 50
      expect(t.totali.recuperoKg).toBe(200)
      expect(t.totali.smaltimentoKg).toBe(100)
      expect(t.totali.giacenzaRecuperoKg).toBe(300)
      expect(t.totali.giacenzaSmaltimentoKg).toBe(250)
      expect(t.perCer.map(v => v.cerCode)).toEqual(['16 02 13*', '17 04 05'])
      // e la somma delle righe dell'aggregato (la fonte del file) dà lo stesso prodotto
      const sommaRighe = a.righe.reduce((s, r) => s + r.prodottoKg, 0)
      expect(sommaRighe).toBe(850)
      expect(t.totali.prodottoKg).toBe(sommaRighe)
    })

    it('stessi numeri dei record BA', async () => {
      const a = await aggrega()
      expect(a.dichiarazioni).toHaveLength(2)
      const base = fixtureDatoCompleto(2025)
      const file = new MudTracciatoV604_2025().generate({
        ...base,
        rifiuti: a.righe,
        dichiarazioni: pacchettiPerExport(a.dichiarazioni, base.azienda),
      })
      // quantità del record come kg (unità 1 = kg, 2 = tonnellate)
      const kg = (valore: string, um: string): number =>
        Number(valore.replace(',', '.')) * (um === '2' ? 1000 : 1)
      const ba = file
        .split('\r\n')
        .filter(l => l.startsWith('BA;'))
        .map(l => {
          const c = l.split(';')
          return {
            codice: c[3],
            cer: c[5],
            prodottoKg: kg(c[13], c[14]),
            giacenzaRecuperoKg: kg(c[27], c[28]),
            giacenzaSmaltimentoKg: kg(c[29], c[30]),
            recuperoKg: kg(c[31], c[32]),
            smaltimentoKg: kg(c[33], c[34]),
          }
        })
      // valori letti dal file, attesi scritti a mano
      expect(ba).toEqual([
        {
          codice: '000000000000001',
          cer: '170405',
          prodottoKg: 500,
          giacenzaRecuperoKg: 300,
          giacenzaSmaltimentoKg: 0,
          recuperoKg: 200,
          smaltimentoKg: 0,
        },
        {
          codice: '000000000000002',
          cer: '160213',
          prodottoKg: 50,
          giacenzaRecuperoKg: 0,
          giacenzaSmaltimentoKg: 50,
          recuperoKg: 0,
          smaltimentoKg: 0,
        },
        {
          codice: '000000000000002',
          cer: '170405',
          prodottoKg: 300,
          giacenzaRecuperoKg: 0,
          giacenzaSmaltimentoKg: 200,
          recuperoKg: 0,
          smaltimentoKg: 100,
        },
      ])
      // e sono quelli di perCer di ogni dichiarazione
      const t = totaliMud(a)
      const dalleDichiarazioni = t.dichiarazioni.flatMap(d =>
        d.perCer.map(v => ({
          codice: d.codice,
          cer: v.cerCode.replace(/[ *]/g, ''),
          prodottoKg: v.prodottoKg,
          giacenzaRecuperoKg: v.giacenzaRecuperoKg,
          giacenzaSmaltimentoKg: v.giacenzaSmaltimentoKg,
          recuperoKg: v.recuperoKg,
          smaltimentoKg: v.smaltimentoKg,
        }))
      )
      expect(dalleDichiarazioni).toEqual(ba)
    })
  })
})
