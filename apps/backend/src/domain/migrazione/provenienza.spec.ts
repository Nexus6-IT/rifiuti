import { IMPORT_SOURCES, IMPORT_SOURCE_WINWASTE, provenienzaValida } from './provenienza'

const LOTTO = '11111111-1111-4111-8111-111111111111'

describe('provenienzaValida (tutti o nessuno)', () => {
  it('nessuna colonna valorizzata: valida (record nato in WasteFlow)', () => {
    expect(provenienzaValida({})).toBe(true)
    expect(provenienzaValida({ importSource: null, legacyKey: null, lottoImportId: null })).toBe(
      true
    )
  })

  it('tutte e tre valide: valida', () => {
    expect(
      provenienzaValida({
        importSource: IMPORT_SOURCE_WINWASTE,
        legacyKey: '0001|2026|MOVIMENTI|1',
        lottoImportId: LOTTO,
      })
    ).toBe(true)
  })

  it.each([
    [{ importSource: 'WINWASTE', legacyKey: null, lottoImportId: null }],
    [{ importSource: null, legacyKey: '0001|2026|MOVIMENTI|1', lottoImportId: null }],
    [{ importSource: null, legacyKey: null, lottoImportId: LOTTO }],
    [{ importSource: 'WINWASTE', legacyKey: '0001|2026|MOVIMENTI|1', lottoImportId: null }],
    [{ importSource: 'ALTRO', legacyKey: '0001|2026|MOVIMENTI|1', lottoImportId: LOTTO }],
    [{ importSource: 'WINWASTE', legacyKey: 'senza-forma', lottoImportId: LOTTO }],
  ])('parziale o malformata: non valida %j', p => {
    expect(provenienzaValida(p)).toBe(false)
  })

  it('elenco delle origini: solo WINWASTE', () => {
    expect([...IMPORT_SOURCES]).toEqual(['WINWASTE'])
  })
})
