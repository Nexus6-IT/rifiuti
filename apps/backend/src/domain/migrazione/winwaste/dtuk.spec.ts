import { decodificaDtuk } from './dtuk'

// docs/movimenti.md §2.2 pos. 11: `aaaammgg`; le query filtrano `dtuk > '0'`.
// Forma dei record annullati verificata sul database modello dell'installer:
// `$$` sostituisce le prime due cifre dell'anno (`$$140131` = 31/01/2014).
describe('decodificaDtuk', () => {
  it('data valida aaaammgg', () => {
    expect(decodificaDtuk('20260105', 2026)).toEqual({
      ok: true,
      valore: { annullato: false, data: '2026-01-05' },
    })
  })

  it('tollera spazi attorno al valore', () => {
    expect(decodificaDtuk(' 20260105 ', 2026)).toEqual({
      ok: true,
      valore: { annullato: false, data: '2026-01-05' },
    })
  })

  it('prefisso $$: annullato, con la data (secolo preso dall anno del database)', () => {
    expect(decodificaDtuk('$$140131', 2014)).toEqual({
      ok: true,
      valore: { annullato: true, data: '2014-01-31', causa: 'PREFISSO_ANNULLO' },
    })
    expect(decodificaDtuk('$$991231', 1999)).toMatchObject({
      ok: true,
      valore: { data: '1999-12-31' },
    })
  })

  it.each([[''], ['0'], [null], ['-1'], ['  ']])(
    'valore <= "0" (%p): annullato o nascosto, senza data',
    v => {
      expect(decodificaDtuk(v, 2026)).toEqual({
        ok: true,
        valore: { annullato: true, data: null, causa: 'NON_POSITIVA' },
      })
    }
  )

  it.each([
    ['mese 13', '20261345'],
    ['giorno 32', '20260132'],
    ['29 febbraio non bisestile', '20260229'],
    ['mese 00', '00000000'],
    ['troppo corta', '2026010'],
    ['non numerica', '2026AB05'],
    ['$$ con mese 13', '$$261345'],
    ['$$ con 29 febbraio non bisestile', '$$260229'],
    ['$$ senza data', '$$'],
    ['$$ con data a 8 cifre (forma non osservata)', '$$20260110'],
    ['$$ con lettere', '$$26AB01'],
  ])('scarta: %s', (_nome, v) => {
    expect(decodificaDtuk(v, 2026)).toMatchObject({ ok: false, codice: 'DTUK_NON_VALIDA' })
  })

  it('accetta il 29 febbraio di un anno bisestile', () => {
    expect(decodificaDtuk('20240229', 2024)).toMatchObject({ ok: true })
    expect(decodificaDtuk('$$240229', 2024)).toMatchObject({ ok: true })
  })

  it('il dettaglio non riporta il valore', () => {
    const r = decodificaDtuk('20261345', 2026)
    expect(r.ok === false && r.dettaglio).not.toContain('20261345')
  })
})
