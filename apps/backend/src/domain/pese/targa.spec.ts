import { normalizzaTarga } from './targa'

describe('normalizzaTarga', () => {
  it.each([
    [' ab 123 cd ', 'AB123CD'],
    ['AB-123.CD', 'AB123CD'],
    ['ab123cd', 'AB123CD'],
  ])('%p → %p', (ingresso, atteso) => {
    expect(normalizzaTarga(ingresso)).toBe(atteso)
  })

  it.each(['A', '', '   ', 'AB 123 €', 'ABCDEFGHIJKLMNOP', 'àb123'])('%p → null', ingresso => {
    expect(normalizzaTarga(ingresso)).toBeNull()
  })

  it('15 caratteri sì, 16 no', () => {
    expect(normalizzaTarga('A'.repeat(15))).toBe('A'.repeat(15))
    expect(normalizzaTarga('A'.repeat(16))).toBeNull()
  })
})
