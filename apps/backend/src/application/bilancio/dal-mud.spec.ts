import { controlliMud, type MudEsitoControllo } from '../mud/aggregazione/mud-controlli'
import type { RifMovimento } from '../mud/aggregazione/mud-controlli'
import { scarichiCoincidono, scarichiGrezziKg, sintesiDalMud } from './dal-mud'
import type { MovimentoBilancio } from './complementi-bilancio'
import { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import { righeCausaliSistema } from '../registro/causali/catalogo-causali.fixture'

const riga = (cerCode: string, p: number, r = 0, d = 0): any => ({
  cerCode,
  prodottoKg: p,
  recuperoKg: r,
  smaltimentoKg: d,
})

const mov = (n: number, quantity: number, unit = 'kg', cerCode = '150101'): RifMovimento => ({
  registroId: 'reg',
  progressiveNumber: n,
  progressiveYear: 2025,
  cerCode,
  causale: 'X',
  quantity,
  unit,
})

const agg = (righe: any[], controlli: MudEsitoControllo[] = [], pericolosi: any = {}): any => ({
  righe,
  controlli,
  pericolosiPerCer: pericolosi,
})

describe('sintesiDalMud', () => {
  it('totali = somma delle righe del MUD, al grammo', () => {
    const s = sintesiDalMud(
      agg([riga('150101', 100.1, 40.2, 10.3), riga('170405', 0.2, 0.1, 0.05)])
    )
    expect(s.prodottoKg).toBe(100.3)
    expect(s.recuperoKg).toBe(40.3)
    expect(s.smaltimentoKg).toBe(10.35)
  })

  it('cerCode canonico con asterisco solo se pericoloso', () => {
    const s = sintesiDalMud(agg([riga('150101', 10), riga('130205', 5)], [], { '130205': true }))
    expect(s.perCer.map(v => v.cerCode)).toEqual(['15 01 01', '13 02 05*'])
    expect(s.perCer.map(v => v.pericoloso)).toEqual([false, true])
    expect(s.perCer[1].cer6).toBe('130205')
  })

  it('pericolosi = prodotto dei CER pericolosi', () => {
    const s = sintesiDalMud(agg([riga('150101', 10), riga('130205', 5.5)], [], { '130205': true }))
    expect(s.pericolosiKg).toBe(5.5)
  })

  it('da verificare: kg e movimenti di OPERAZIONE_DEDOTTA_DAL_FIR e OPERAZIONE_NON_INDICATA', () => {
    const s = sintesiDalMud(
      agg(
        [],
        [
          controlliMud.operazioneDedottaDalFir(mov(1, 100), 'FIR1', 'R'),
          controlliMud.operazioneNonIndicata(mov(2, 50)),
          controlliMud.causaleEsclusa(mov(3, 999)),
        ]
      )
    )
    expect(s.daVerificare).toEqual({ kg: 150, movimenti: 2, senzaKg: 0 })
  })

  it('da verificare: i movimenti in litri senza peso specifico sono contati a parte', () => {
    const s = sintesiDalMud(
      agg(
        [],
        [
          controlliMud.operazioneNonIndicata(mov(1, 100)),
          controlliMud.operazioneNonIndicata(mov(2, 300, 'l')),
        ]
      )
    )
    expect(s.daVerificare).toEqual({ kg: 100, movimenti: 2, senzaKg: 1 })
  })

  it('da verificare: i litri convertiti dal MUD col peso specifico hanno i loro kg', () => {
    const litri = mov(2, 300, 'l')
    const s = sintesiDalMud(
      agg(
        [],
        [
          controlliMud.operazioneNonIndicata(mov(1, 100)),
          controlliMud.operazioneNonIndicata(litri),
          controlliMud.convertitoConPesoSpecifico('150101', 'l', 0.5, [litri], false),
        ]
      )
    )
    expect(s.daVerificare).toEqual({ kg: 250, movimenti: 2, senzaKg: 0 })
  })

  it('non convertiti: movimenti di UNITA_NON_DI_MASSA', () => {
    const s = sintesiDalMud(
      agg([], [controlliMud.unitaNonDiMassa(2025, '150101', 'l', [mov(1, 5, 'l'), mov(2, 7, 'l')])])
    )
    expect(s.nonConvertiti).toBe(2)
  })

  it('stimati: kg di CONVERTITO_CON_PESO_SPECIFICO', () => {
    const s = sintesiDalMud(
      agg(
        [],
        [controlliMud.convertitoConPesoSpecifico('150101', 'l', 0.9, [mov(1, 100, 'l')], false)]
      )
    )
    expect(s.stimatiKg).toBe(90)
  })

  it('esclusi: kg in meno del riepilogo avvisi, senza le giacenze', () => {
    const s = sintesiDalMud(
      agg(
        [],
        [
          controlliMud.causaleEsclusa(mov(1, 30)),
          controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '150101', kg: 200 }]),
        ]
      )
    )
    expect(s.esclusi.kg).toBe(30)
    expect(s.esclusi.nonQuantificati).toBe(0)
    expect(s.giacenzaKg).toBe(200)
  })

  it('senza GIACENZE_NON_CALCOLATE la giacenza è 0', () => {
    expect(sintesiDalMud(agg([riga('150101', 1)])).giacenzaKg).toBe(0)
  })
})

describe('confronto degli scarichi grezzi con il MUD', () => {
  const catalogo = new CatalogoCausali(righeCausaliSistema(), [])
  const scarico = (quantity: number, unit = 'kg', extra: any = {}): MovimentoBilancio =>
    ({
      type: 'SCARICO',
      causale: 'CONFERIMENTO_TRASPORTATORE',
      causaleAziendaId: null,
      movementDate: new Date('2025-05-10T10:00:00Z'),
      quantity,
      unit,
      operationCode: null,
      fir: null,
      ...extra,
    }) as any

  it('somma i soli scarichi avviati entro la data', () => {
    const kg = scarichiGrezziKg(
      catalogo,
      [scarico(100), scarico(1, 't'), scarico(50, 'l'), scarico(70, 'kg', { type: 'CARICO' })],
      '2025-12-31'
    )
    expect(kg).toBe(1100)
  })

  it('i litri convertiti dal MUD contano coi suoi kg: la lacuna non scatta', () => {
    const movimenti = [scarico(100), scarico(300, 'l', { chiave: '2025/2@reg' })]
    const grezzo = scarichiGrezziKg(catalogo, movimenti, '2025-12-31', { '2025/2@reg': 150 })
    expect(grezzo).toBe(250)
    expect(scarichiCoincidono(grezzo, 250)).toBe(true)
  })

  it('uno scarico con FIR annullato o in bozza non conta: la lacuna non scatta', () => {
    const fir = (status: string) => ({
      id: 'f',
      status,
      firNumber: null,
      rentriNumeroFir: null,
      rentriStatoFormulario: null,
      wasteOperationCode: null,
    })
    const grezzo = scarichiGrezziKg(
      catalogo,
      [
        scarico(100),
        scarico(40, 'kg', { fir: fir('CANCELLED') }),
        scarico(60, 'kg', { fir: fir('DRAFT') }),
      ],
      '2025-12-31'
    )
    expect(grezzo).toBe(100)
    expect(scarichiCoincidono(grezzo, 100)).toBe(true)
  })

  it('coincidono quando il grezzo è uguale a R + D', () => {
    expect(scarichiCoincidono(1100, 1100)).toBe(true)
  })

  it('differiscono quando ci sono doppi o ricopie', () => {
    expect(scarichiCoincidono(1300, 1100)).toBe(false)
  })
})
