import {
  calcolaScadenze,
  descriviRate,
  ETICHETTE_MODALITA,
  MODALITA_PAGAMENTO,
  normalizzaCondizione,
  validaCodiceTabella,
  validaCondizione,
  type DatiCondizionePagamento,
} from './condizione-pagamento'

const valida = (extra: Partial<DatiCondizionePagamento> = {}): DatiCondizionePagamento => ({
  codice: 'BB30',
  descrizione: 'Bonifico 30 gg',
  modalita: 'MP05',
  giorniRate: [30],
  fineMese: false,
  ...extra,
})

describe('validaCondizione', () => {
  it('condizione valida', () => expect(validaCondizione(valida())).toEqual([]))

  it('codice vuoto, con spazio, di 11 caratteri', () => {
    expect(validaCondizione(valida({ codice: '' }))).toHaveLength(1)
    expect(validaCondizione(valida({ codice: 'A B' }))).toHaveLength(1)
    expect(validaCondizione(valida({ codice: 'A'.repeat(11) }))).toHaveLength(1)
    expect(validaCondizione(valida({ codice: 'A'.repeat(10) }))).toEqual([])
  })

  it('descrizione vuota e di 101 caratteri', () => {
    expect(validaCondizione(valida({ descrizione: '' }))).toHaveLength(1)
    expect(validaCondizione(valida({ descrizione: 'D'.repeat(101) }))).toHaveLength(1)
    expect(validaCondizione(valida({ descrizione: 'D'.repeat(100) }))).toEqual([])
  })

  it('modalità non ammessa', () => {
    expect(validaCondizione(valida({ modalita: 'MP99' as never }))).toEqual([
      'Modalità di pagamento non ammessa.',
    ])
  })

  it('zero rate e nove rate', () => {
    expect(validaCondizione(valida({ giorniRate: [] }))).toEqual(['Indica almeno una rata.'])
    expect(validaCondizione(valida({ giorniRate: [10, 20, 30, 40, 50, 60, 70, 80, 90] }))).toEqual([
      'Al massimo 8 rate.',
    ])
  })

  it('giorni non crescenti, fuori intervallo, a vista', () => {
    expect(validaCondizione(valida({ giorniRate: [60, 30] }))).toEqual([
      'I giorni delle rate devono essere crescenti.',
    ])
    expect(validaCondizione(valida({ giorniRate: [30, 30] }))).toEqual([
      'I giorni delle rate devono essere crescenti.',
    ])
    expect(validaCondizione(valida({ giorniRate: [366] }))).toEqual([
      'I giorni delle rate vanno da 0 a 365.',
    ])
    expect(validaCondizione(valida({ giorniRate: [0, 30] }))).toEqual([
      'Il pagamento a vista ha una sola rata.',
    ])
    expect(validaCondizione(valida({ giorniRate: [0] }))).toEqual([])
  })
})

describe('normalizzaCondizione', () => {
  it('trim, giorni numerici, modalità maiuscola', () => {
    const d = normalizzaCondizione({
      codice: ' X1 ',
      descrizione: ' desc ',
      modalita: ' mp05 ',
      giorniRate: ['30', 60],
      fineMese: true,
    })
    expect(d).toEqual({
      codice: 'X1',
      descrizione: 'desc',
      modalita: 'MP05',
      giorniRate: [30, 60],
      fineMese: true,
    })
    expect(normalizzaCondizione({}).giorniRate).toEqual([])
    expect(normalizzaCondizione({}).fineMese).toBe(false)
  })

  it('vocabolario completo', () => {
    expect(Object.keys(ETICHETTE_MODALITA)).toEqual([...MODALITA_PAGAMENTO])
    expect(ETICHETTE_MODALITA.MP05).toBe('Bonifico')
  })
})

describe('calcolaScadenze', () => {
  const c = (giorniRate: number[], fineMese = false) => ({ giorniRate, fineMese })

  it('31 gennaio + 30 -> 28 febbraio', () => {
    expect(calcolaScadenze('2026-01-31', c([30]))).toEqual(['2026-02-28'])
  })
  it('anno bisestile: 31 gennaio + 30 -> 29 febbraio', () => {
    expect(calcolaScadenze('2028-01-31', c([30]))).toEqual(['2028-02-29'])
  })
  it('30-60-90 = tre mesi di calendario', () => {
    expect(calcolaScadenze('2026-01-15', c([30, 60, 90]))).toEqual([
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ])
  })
  it('giorni non multipli di 30 = giorni', () => {
    expect(calcolaScadenze('2026-01-15', c([45]))).toEqual(['2026-03-01'])
  })
  it('fine mese', () => {
    expect(calcolaScadenze('2026-01-15', c([30], true))).toEqual(['2026-02-28'])
    expect(calcolaScadenze('2026-12-20', c([30], true))).toEqual(['2027-01-31'])
  })
  it('a vista', () => {
    expect(calcolaScadenze('2026-01-15', c([0]))).toEqual(['2026-01-15'])
    expect(calcolaScadenze('2026-01-15', c([0], true))).toEqual(['2026-01-31'])
  })
})

describe('descriviRate', () => {
  it('a vista e rate a fine mese', () => {
    expect(descriviRate({ giorniRate: [0], fineMese: false })).toBe('a vista')
    expect(descriviRate({ giorniRate: [30, 60], fineMese: true })).toBe('30-60 gg fine mese')
    expect(descriviRate({ giorniRate: [30], fineMese: false })).toBe('30 gg')
  })
})

describe('validaCodiceTabella (riesportata)', () => {
  it('messaggio del codice con spazio', () => {
    expect(validaCodiceTabella('A B', 10, 'Il codice')).toBe(
      'Il codice può contenere solo lettere, cifre, punto, trattino e trattino basso (massimo 10 caratteri).'
    )
  })
})
