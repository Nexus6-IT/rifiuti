import { confrontaConDtuk, decodificaDataDocumento, decodificaDatr } from './data-registrazione'
import { decodificaDtuk, DtukDecodificata } from './dtuk'

// docs/movimenti.md §2.1: la data si inserisce `gg-mm` e l'anno e' quello del database.
describe('decodificaDatr', () => {
  it('gg-mm + anno del database', () => {
    expect(decodificaDatr('05-01', 2026)).toEqual({ ok: true, valore: '2026-01-05' })
  })

  it.each([[''], [null], ['  ']])('vuoto (%p) = assente', v => {
    expect(decodificaDatr(v, 2026)).toEqual({ ok: true, valore: null })
  })

  it('29-02 solo negli anni bisestili', () => {
    expect(decodificaDatr('29-02', 2024)).toEqual({ ok: true, valore: '2024-02-29' })
    expect(decodificaDatr('29-02', 2026)).toMatchObject({ ok: false, codice: 'DATR_NON_VALIDA' })
  })

  it.each([['5-1'], ['05/01'], ['31-04'], ['00-01'], ['01-13'], ['aa-bb']])('scarta %s', v => {
    expect(decodificaDatr(v, 2026)).toMatchObject({ ok: false, codice: 'DATR_NON_VALIDA' })
  })
})

// docs/formulari.md §2.1 col. 8: `DATD` = data documento `gg-mm-aaaa`.
describe('decodificaDataDocumento', () => {
  it('gg-mm-aaaa', () => {
    expect(decodificaDataDocumento('20-01-2026')).toEqual({ ok: true, valore: '2026-01-20' })
  })
  it.each([[''], [null]])('vuoto (%p) = assente', v => {
    expect(decodificaDataDocumento(v)).toEqual({ ok: true, valore: null })
  })
  it.each([['20-01-26'], ['31-04-2026'], ['2026-01-20']])('scarta %s', v => {
    expect(decodificaDataDocumento(v)).toMatchObject({ ok: false, codice: 'DATD_NON_VALIDA' })
  })
})

describe('confrontaConDtuk', () => {
  const dtuk = (v: string): DtukDecodificata => {
    const r = decodificaDtuk(v)
    if (!r.ok) throw new Error('fixture')
    return r.valore
  }
  it('coincide', () => expect(confrontaConDtuk('2026-01-05', dtuk('20260105'))).toBe(true))
  it('diversa', () => expect(confrontaConDtuk('2026-03-04', dtuk('20260305'))).toBe(false))
  it('nulla da confrontare se manca la data o la data di DTUK', () => {
    expect(confrontaConDtuk(null, dtuk('20260105'))).toBe(true)
    expect(confrontaConDtuk('2026-01-05', dtuk('0'))).toBe(true)
  })
})
