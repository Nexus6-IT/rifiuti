import { decodificaSoggetto } from './soggetto'

// docs/schema-db-winwaste.md §2.2: PROD/TRAS/SMAL/INTE = soggetto.unita in 11 caratteri.
describe('decodificaSoggetto', () => {
  it('soggetto.unita, marcato come dedotto', () => {
    expect(decodificaSoggetto('000020.0001')).toEqual({
      ok: true,
      valore: { soggetto: { codice: '000020', unita: '0001' }, dedotta: true },
    })
    expect(decodificaSoggetto('X90000.0002')).toMatchObject({
      ok: true,
      valore: { soggetto: { codice: 'X90000', unita: '0002' } },
    })
  })

  it.each([[''], ['0'], [null], ['  ']])('%p = nessun soggetto', v => {
    expect(decodificaSoggetto(v)).toEqual({ ok: true, valore: { soggetto: null, dedotta: true } })
  })

  it.each([['000020'], ['000020.'], ['0000201.0001'], ['000020.00012'], ['00 020.0001']])(
    'scarta %s',
    v => {
      expect(decodificaSoggetto(v)).toMatchObject({ ok: false, codice: 'SOGGETTO_FORMATO' })
    }
  )
})
