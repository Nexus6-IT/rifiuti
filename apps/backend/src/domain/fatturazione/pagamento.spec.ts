import { abiCabDaIban, calcolaRate, type DatiBanca } from './pagamento'

const IBAN = 'IT60X0542811101000000123456'
const banca: DatiBanca = { istituto: 'Banca X', iban: IBAN, bic: 'BCITITMM' }
const base = (
  over: Partial<Parameters<typeof calcolaRate>[0]> = {}
): Parameters<typeof calcolaRate>[0] => ({
  netto: '100.00',
  dataDocumento: '2026-01-15',
  condizione: { modalita: 'MP08', giorniRate: [30, 60, 90], fineMese: false },
  esigibilita: 'I',
  contoCedente: null,
  bancaCliente: null,
  ...over,
})

describe('calcolaRate', () => {
  it('100.00 in 3 rate: 33.33, 33.33, 33.34', () => {
    expect(calcolaRate(base()).rate.map(r => r.importo)).toEqual(['33.33', '33.33', '33.34'])
  })
  it('200.00 in 3: 66.66, 66.66, 66.68', () => {
    expect(calcolaRate(base({ netto: '200.00' })).rate.map(r => r.importo)).toEqual([
      '66.66',
      '66.66',
      '66.68',
    ])
  })
  it('una rata TP02, piu rate TP01', () => {
    expect(
      calcolaRate(base({ condizione: { modalita: 'MP08', giorniRate: [30], fineMese: false } }))
        .condizioniPagamento
    ).toBe('TP02')
    expect(calcolaRate(base()).condizioniPagamento).toBe('TP01')
  })
  it('30 giorni fine mese dal 15/01: 28/02, 29/02 se bisestile', () => {
    const c = { modalita: 'MP08', giorniRate: [30], fineMese: true }
    expect(calcolaRate(base({ condizione: c })).rate[0].dataScadenza).toBe('2026-02-28')
    expect(
      calcolaRate(base({ condizione: c, dataDocumento: '2028-01-15' })).rate[0].dataScadenza
    ).toBe('2028-02-29')
  })
  it('MP05 senza IBAN nel cedente: errore anche se il cliente ha IBAN', () => {
    const r = calcolaRate(
      base({
        condizione: { modalita: 'MP05', giorniRate: [30], fineMese: false },
        bancaCliente: banca,
      })
    )
    expect(r.errori.map(e => e.codice)).toEqual(['PAGAMENTO_SENZA_BANCA'])
  })
  it('MP05 con contoCedente: IBAN, istituto, ABI e CAB', () => {
    const r = calcolaRate(
      base({
        condizione: { modalita: 'MP05', giorniRate: [30], fineMese: false },
        contoCedente: banca,
      })
    )
    expect(r.errori).toEqual([])
    expect(r.rate[0]).toMatchObject({
      iban: IBAN,
      istituto: 'Banca X',
      abi: '05428',
      cab: '11101',
      bic: 'BCITITMM',
    })
  })
  it('MP12 usa bancaCliente; senza: errore', () => {
    const c = { modalita: 'MP12', giorniRate: [30], fineMese: false }
    expect(
      calcolaRate(base({ condizione: c, bancaCliente: banca, contoCedente: null })).rate[0].iban
    ).toBe(IBAN)
    expect(
      calcolaRate(base({ condizione: c, contoCedente: banca })).errori.map(e => e.codice)
    ).toEqual(['PAGAMENTO_SENZA_BANCA'])
  })
  it('MP01 con esigibilita S o D: PAGAMENTO_NON_AMMESSO; con I no', () => {
    const c = { modalita: 'MP01', giorniRate: [0], fineMese: false }
    expect(
      calcolaRate(base({ condizione: c, esigibilita: 'S' })).errori.map(e => e.codice)
    ).toEqual(['PAGAMENTO_NON_AMMESSO'])
    expect(
      calcolaRate(base({ condizione: c, esigibilita: 'D' })).errori.map(e => e.codice)
    ).toEqual(['PAGAMENTO_NON_AMMESSO'])
    expect(calcolaRate(base({ condizione: c })).errori).toEqual([])
  })
  it('split: la somma delle rate e il netto senza IVA', () => {
    const r = calcolaRate(base({ netto: '122.00', esigibilita: 'S' }))
    expect(r.rate.reduce((s, x) => s + Number(x.importo), 0).toFixed(2)).toBe('122.00')
  })
})

describe('abiCabDaIban', () => {
  it('IBAN italiano', () => expect(abiCabDaIban(IBAN)).toEqual({ abi: '05428', cab: '11101' }))
  it('IBAN estero o non valido: null', () => {
    expect(abiCabDaIban('DE89370400440532013000')).toBeNull()
    expect(abiCabDaIban('IT00X0542811101000000123456')).toBeNull()
  })
})
