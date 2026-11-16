import { dataValida, errore, iso, ok } from './risultato'

describe('risultato', () => {
  it('ok ed errore costruiscono gli esiti', () => {
    expect(ok(3)).toEqual({ ok: true, valore: 3 })
    expect(errore('X', 'd')).toEqual({ ok: false, codice: 'X', dettaglio: 'd' })
  })

  it.each([
    [2026, 2, 28, true],
    [2026, 2, 29, false], // non bisestile
    [2024, 2, 29, true],
    [1900, 2, 29, false], // secolare non bisestile
    [2000, 2, 29, true], // secolare bisestile
    [2026, 4, 31, false],
    [2026, 13, 1, false],
    [2026, 0, 1, false],
    [2026, 1, 0, false],
    [2026, 12, 31, true],
    [1800, 1, 1, false],
    [2300, 1, 1, false],
  ])('dataValida(%i, %i, %i) = %s', (a, m, g, atteso) => {
    expect(dataValida(a, m, g)).toBe(atteso)
  })

  it('iso formatta con zeri', () => {
    expect(iso(2026, 1, 5)).toBe('2026-01-05')
  })
})
