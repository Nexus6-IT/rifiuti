import { cerCanonico, cerSoloCifre, chiaveConfrontoCer } from './cer-registro'

describe('cerSoloCifre', () => {
  it('toglie spazi, punti e asterisco', () => {
    expect(cerSoloCifre('20 03 01')).toBe('200301')
    expect(cerSoloCifre('200301')).toBe('200301')
    expect(cerSoloCifre(' 16.06.01* ')).toBe('160601')
  })

  it('stringa vuota se non ci sono cifre', () => {
    expect(cerSoloCifre('')).toBe('')
    expect(cerSoloCifre('abc')).toBe('')
  })
})

describe('cerCanonico', () => {
  it('"NN NN NN" per ogni formato di 6 cifre', () => {
    expect(cerCanonico('200301')).toBe('20 03 01')
    expect(cerCanonico(' 20  03 01 ')).toBe('20 03 01')
    expect(cerCanonico('20.03.01')).toBe('20 03 01')
  })

  it("conserva l'asterisco dei pericolosi", () => {
    expect(cerCanonico('160601*')).toBe('16 06 01*')
    expect(cerCanonico('16 06 01 *')).toBe('16 06 01*')
  })

  it('fuori formato restituisce il testo ripulito, mai una stringa vuota', () => {
    expect(cerCanonico(' 1234 ')).toBe('1234')
    expect(cerCanonico(' abc ')).toBe('abc')
    expect(cerCanonico('')).toBe('')
  })
})

describe('chiaveConfrontoCer', () => {
  it('stesso rifiuto con o senza spazi e asterisco', () => {
    expect(chiaveConfrontoCer('200301')).toBe(chiaveConfrontoCer('20 03 01'))
    expect(chiaveConfrontoCer('16 06 01*')).toBe(chiaveConfrontoCer('160601'))
  })

  it('due codici senza cifre non si fondono in una chiave vuota', () => {
    expect(chiaveConfrontoCer('abc')).not.toBe('')
    expect(chiaveConfrontoCer('abc')).not.toBe(chiaveConfrontoCer('xyz'))
  })
})
