import { inviiSdiAttivi } from './invii-sdi-attivi'

describe('inviiSdiAttivi', () => {
  const originale = process.env.SDI_INVII_ATTIVI
  afterEach(() => {
    if (originale === undefined) delete process.env.SDI_INVII_ATTIVI
    else process.env.SDI_INVII_ATTIVI = originale
  })

  it('assente: spento (default)', () => {
    delete process.env.SDI_INVII_ATTIVI
    expect(inviiSdiAttivi()).toBe(false)
  })

  it('solo il letterale "true" li accende', () => {
    process.env.SDI_INVII_ATTIVI = 'true'
    expect(inviiSdiAttivi()).toBe(true)
  })

  it.each(['', '1', 'yes', 'TRUE', ' true', 'false', 'on'])('"%s": spento', valore => {
    process.env.SDI_INVII_ATTIVI = valore
    expect(inviiSdiAttivi()).toBe(false)
  })
})
