import { confrontaConNumerici, decodificaQuantita } from './quantita'

// docs/movimenti.md §2.2 pos. 35-39 (NETTO kg, VOLU + UM M/L) e §2.5 (KGNUM, MCNUM).
describe('decodificaQuantita', () => {
  it('un netto ambiguo (1.000) e uno scarto, non mille', () => {
    expect(decodificaQuantita({ netto: '1.000', volu: '2', um: 'M' })).toMatchObject({
      ok: false,
      codice: 'NUMERO_IT',
    })
  })

  it('netto in kg, volume in m3', () => {
    expect(decodificaQuantita({ netto: '1000', volu: '2,5', um: 'M' })).toEqual({
      ok: true,
      valore: { nettoKg: 1000, volumeM3: 2.5 },
    })
  })

  it('litri convertiti in m3 (/1000)', () => {
    expect(decodificaQuantita({ netto: '1800', volu: '2000', um: 'L' })).toEqual({
      ok: true,
      valore: { nettoKg: 1800, volumeM3: 2 },
    })
    expect(decodificaQuantita({ netto: '', volu: '1', um: 'l' })).toEqual({
      ok: true,
      valore: { nettoKg: null, volumeM3: 0.001 },
    })
  })

  it('senza volume l unita si ignora', () => {
    expect(decodificaQuantita({ netto: '10', volu: '', um: 'Z' })).toEqual({
      ok: true,
      valore: { nettoKg: 10, volumeM3: null },
    })
    expect(decodificaQuantita({ netto: null, volu: null, um: null })).toEqual({
      ok: true,
      valore: { nettoKg: null, volumeM3: null },
    })
  })

  it.each([[''], ['X'], [null]])('volume con unita %p -> UM_SCONOSCIUTA', um => {
    expect(decodificaQuantita({ netto: '10', volu: '5', um })).toMatchObject({
      ok: false,
      codice: 'UM_SCONOSCIUTA',
    })
  })

  it('numeri non validi -> NUMERO_IT con il nome della colonna nel dettaglio', () => {
    const a = decodificaQuantita({ netto: 'abc', volu: '', um: '' })
    expect(a).toMatchObject({ ok: false, codice: 'NUMERO_IT' })
    expect(a.ok === false && a.dettaglio).toContain('NETTO')
    const b = decodificaQuantita({ netto: '1', volu: '1.5', um: 'M' })
    expect(b.ok === false && b.dettaglio).toContain('VOLU')
  })
})

describe('confrontaConNumerici', () => {
  const q = { nettoKg: 1000, volumeM3: 2 }
  it('coerente entro la tolleranza di 0,001', () => {
    expect(confrontaConNumerici(q, 1000.0005, 2.0005)).toEqual([])
    expect(confrontaConNumerici(q, 1000.001, 2.001)).toEqual([])
  })
  it('KGNUM e MCNUM incoerenti', () => {
    expect(confrontaConNumerici(q, 900, 2)).toEqual(['KGNUM_INCOERENTE'])
    expect(confrontaConNumerici(q, 1000, 3)).toEqual(['MCNUM_INCOERENTE'])
    expect(confrontaConNumerici(q, 900, 3)).toEqual(['KGNUM_INCOERENTE', 'MCNUM_INCOERENTE'])
  })
  it('un testo vuoto vale zero contro un numerico positivo', () => {
    expect(confrontaConNumerici({ nettoKg: null, volumeM3: null }, 5, 0)).toEqual([
      'KGNUM_INCOERENTE',
    ])
  })
  it('numerici assenti: niente da confrontare', () => {
    expect(confrontaConNumerici(q, null, null)).toEqual([])
  })
  it('tolleranza alzata per FORMULARI (decimal(18,0))', () => {
    expect(confrontaConNumerici({ nettoKg: 12.5, volumeM3: null }, 13, null, 1)).toEqual([])
  })
})
