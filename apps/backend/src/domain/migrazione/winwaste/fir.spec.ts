import { deduciStatoFir, firDigitale } from './fir'

describe('deduciStatoFir (docs/formulari.md §2.1: DATF fine trasporto, pesi a destino)', () => {
  it('data di fine trasporto e peso a destino: COMPLETED, con la data', () => {
    expect(deduciStatoFir({ datf: '12-03-2026', nettoKg: 1500 })).toEqual({
      stato: 'COMPLETED',
      dataFine: '2026-03-12',
    })
  })

  it.each([
    ['senza data di fine', { datf: '', nettoKg: 1500 }],
    ['senza data di fine (null)', { datf: null, nettoKg: 1500 }],
    ['senza peso', { datf: '12-03-2026', nettoKg: null }],
    ['peso zero', { datf: '12-03-2026', nettoKg: 0 }],
    ['data illeggibile: non si inventa il completamento', { datf: '31-02-2026', nettoKg: 10 }],
    ['data in un altro formato', { datf: '2026-03-12', nettoKg: 10 }],
  ])('%s: AWAITING_RECEIVER, nessuna data', (_n, input) => {
    expect(deduciStatoFir(input)).toEqual({ stato: 'AWAITING_RECEIVER', dataFine: null })
  })
})

describe('firDigitale', () => {
  it.each([
    ['DIGITALE', true],
    ['INVIATO A RENTRI DA mario', true],
    ['', false],
    ['digitale', true],
    ['ALTRO', false],
  ])('C6 %p -> %p', (c6, atteso) => {
    expect(firDigitale(c6)).toBe(atteso)
  })
})
