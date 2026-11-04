import { riepilogoEsito } from './da-collegare.component'

describe('riepilogoEsito', () => {
  it('conferma: «3 confermati, 1 saltato»', () => {
    expect(
      riepilogoEsito('CONFERMA', {
        riusciti: 3,
        falliti: [{ legameId: 'a', codice: 'X', messaggio: 'm' }],
      })
    ).toBe('3 confermati, 1 saltato')
  })

  it('singolari e plurali', () => {
    expect(riepilogoEsito('CONFERMA', { riusciti: 1, falliti: [] })).toBe('1 confermato')
    expect(
      riepilogoEsito('ESCLUDI', {
        riusciti: 2,
        falliti: [
          { legameId: 'a', codice: 'X', messaggio: 'm' },
          { legameId: 'b', codice: 'X', messaggio: 'm' },
        ],
      })
    ).toBe('2 esclusi, 2 saltati')
    expect(riepilogoEsito('ESCLUDI', { riusciti: 1, falliti: [] })).toBe('1 escluso')
  })

  it('tutti saltati: «0 confermati, 2 saltati»', () => {
    expect(
      riepilogoEsito('CONFERMA', {
        riusciti: 0,
        falliti: [
          { legameId: null, movimentoId: 'm', codice: 'X', messaggio: 'm' },
          { legameId: null, movimentoId: 'n', codice: 'X', messaggio: 'm' },
        ],
      })
    ).toBe('0 confermati, 2 saltati')
  })
})
