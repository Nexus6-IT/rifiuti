import { decodificaCer } from './cer'

// docs/formulari.md §2.1 col. 30-34: CER (6 cifre) e TIPOL (P/Q = pericoloso).
describe('decodificaCer', () => {
  it('non pericoloso', () => {
    expect(decodificaCer('150102', 'S')).toEqual({
      ok: true,
      valore: { codice: '15 01 02', pericoloso: false },
    })
  })

  it.each([['P'], ['Q'], ['p']])('tipologia %s: asterisco', t => {
    expect(decodificaCer('150110', t)).toEqual({
      ok: true,
      valore: { codice: '15 01 10*', pericoloso: true },
    })
  })

  it('tipologia assente o ignota: non pericoloso', () => {
    expect(decodificaCer('150102', null)).toMatchObject({ valore: { pericoloso: false } })
    expect(decodificaCer('150102', 'R')).toMatchObject({ valore: { pericoloso: false } })
  })

  it.each([[''], [null], ['  ']])('vuoto (%p) = assente', v => {
    expect(decodificaCer(v, 'P')).toEqual({ ok: true, valore: null })
  })

  it.each([['1501'], ['15 01 02'], ['1501021'], ['15010A'], ['15011*']])('scarta %s', v => {
    expect(decodificaCer(v, 'P')).toMatchObject({ ok: false, codice: 'CER_FORMATO' })
  })
})
