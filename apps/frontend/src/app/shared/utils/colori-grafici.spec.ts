import { coloriGrafico } from './colori-grafici'

describe('coloriGrafico', () => {
  it('in chiaro usa il teal scuro e testo scuro', () => {
    const c = coloriGrafico('chiaro')
    expect(c.primario).toBe('#0f766e')
    expect(c.testo).toBe('#3d5052')
  })

  it('in scuro usa il teal chiaro e testo chiaro', () => {
    const c = coloriGrafico('scuro')
    expect(c.primario).toBe('#3fc5b5')
    expect(c.testo).toBe('#b4c4c3')
  })

  it('le due tavolozze hanno le stesse chiavi', () => {
    expect(Object.keys(coloriGrafico('scuro')).sort()).toEqual(
      Object.keys(coloriGrafico('chiaro')).sort()
    )
  })

  it('la griglia in scuro non è più chiara del testo', () => {
    const c = coloriGrafico('scuro')
    expect(c.griglia).not.toBe(c.testo)
  })
})
