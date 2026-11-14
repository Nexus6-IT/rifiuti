import { decodificaC4 } from './c4'

function c4(p: Record<number, string>): string {
  return Array.from({ length: 31 }, (_, i) => p[i] ?? '').join('§')
}

// docs/formulari.md §2.2 e docs/rentri/03-aggancio-a-winwaste.md §3.2.
describe('decodificaC4', () => {
  it.each([[''], [null]])('vuoto (%p): tutti i sottocampi assenti', v => {
    expect(decodificaC4(v)).toEqual({
      ok: true,
      valore: {
        trasbordo: null,
        idEsterno: null,
        quantitaOrigine: null,
        unitaOrigine: null,
        pesoVerifica: null,
        respingimento: null,
        soloDetentore: false,
        trasportoEstero: '',
        verificatoInPartenza: false,
        centroRaccolta: '',
      },
    })
  })

  it('legge le posizioni nominate', () => {
    const r = decodificaC4(
      c4({
        5: 'FIR-0001\\nota di trasbordo',
        14: '^EXT-0001^',
        15: '1.500,5',
        16: 'k',
        22: '1480',
        23: '1',
        24: 'altro',
        25: '10',
        26: 'L',
        27: '1',
        28: '2x',
        29: '1',
        30: 'S',
      })
    )
    expect(r).toEqual({
      ok: true,
      valore: {
        trasbordo: { firOrigine: 'FIR-0001', note: 'nota di trasbordo' },
        idEsterno: 'EXT-0001',
        quantitaOrigine: 1500.5,
        unitaOrigine: 'K',
        pesoVerifica: 1480,
        respingimento: { causale: '1', altraCausale: 'altro', quantita: 10, unita: 'L' },
        soloDetentore: true,
        trasportoEstero: '2',
        verificatoInPartenza: true,
        centroRaccolta: 'S',
      },
    })
  })

  it('trasbordo senza note; posizione 14 non fra ^ non e un id esterno', () => {
    const r = decodificaC4(c4({ 5: 'FIR-9', 14: 'EXT' }))
    expect(r).toMatchObject({
      ok: true,
      valore: { trasbordo: { firOrigine: 'FIR-9', note: '' }, idEsterno: null },
    })
  })

  it('un respingimento con la sola quantita o la sola unita e comunque un respingimento', () => {
    expect(decodificaC4(c4({ 25: '5' }))).toMatchObject({
      ok: true,
      valore: { respingimento: { quantita: 5, unita: null } },
    })
    expect(decodificaC4(c4({ 26: 'K' }))).toMatchObject({
      ok: true,
      valore: { respingimento: { quantita: null, unita: 'K' } },
    })
  })

  it('meno di 31 posizioni: le mancanti sono vuote', () => {
    expect(decodificaC4('§§§')).toMatchObject({ ok: true, valore: { respingimento: null } })
  })

  it.each([
    [c4({ 15: '1.5' }), 'C4_NUMERO', 'posizione 15'],
    [c4({ 22: 'x' }), 'C4_NUMERO', 'posizione 22'],
    [c4({ 25: 'x' }), 'C4_NUMERO', 'posizione 25'],
    [c4({ 16: 'Z' }), 'C4_UNITA', 'posizione 16'],
    [c4({ 26: 'Z' }), 'C4_UNITA', 'posizione 26'],
  ])('errore %#', (valore, codice, dettaglio) => {
    const r = decodificaC4(valore)
    expect(r).toMatchObject({ ok: false, codice })
    expect(r.ok === false && r.dettaglio).toContain(dettaglio)
  })
})
