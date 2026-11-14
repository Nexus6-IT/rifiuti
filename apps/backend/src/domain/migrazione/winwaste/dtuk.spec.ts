import { decodificaDtuk } from './dtuk'

// docs/movimenti.md §2.2 pos. 11: `aaaammgg`; prefisso `$$` = annullato o nascosto;
// le query filtrano `dtuk > '0'`.
describe('decodificaDtuk', () => {
  it('data valida aaaammgg', () => {
    expect(decodificaDtuk('20260105')).toEqual({
      ok: true,
      valore: { annullato: false, data: '2026-01-05' },
    })
  })

  it('tollera spazi attorno al valore', () => {
    expect(decodificaDtuk(' 20260105 ')).toEqual({
      ok: true,
      valore: { annullato: false, data: '2026-01-05' },
    })
  })

  it('prefisso $$: annullato, con la data', () => {
    expect(decodificaDtuk('$$20260110')).toEqual({
      ok: true,
      valore: { annullato: true, data: '2026-01-10', causa: 'PREFISSO_ANNULLO' },
    })
  })

  it.each([[''], ['0'], [null], ['-1'], ['  ']])(
    'valore <= "0" (%p): annullato o nascosto, senza data',
    v => {
      expect(decodificaDtuk(v)).toEqual({
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
    ['$$ con data non valida', '$$20261345'],
    ['$$ senza data', '$$'],
  ])('scarta: %s', (_nome, v) => {
    expect(decodificaDtuk(v)).toMatchObject({ ok: false, codice: 'DTUK_NON_VALIDA' })
  })

  it('accetta il 29 febbraio di un anno bisestile', () => {
    expect(decodificaDtuk('20240229')).toMatchObject({ ok: true })
  })

  it('il dettaglio non riporta il valore', () => {
    const r = decodificaDtuk('20261345')
    expect(r.ok === false && r.dettaglio).not.toContain('20261345')
  })
})
