import { coloriGrafico } from './colori-grafici'

describe('coloriGrafico', () => {
  it('in chiaro usa i valori IgniCraft', () => {
    expect(coloriGrafico('chiaro')).toEqual({
      testo: '#6b6964',
      griglia: '#eeece8',
      primario: '#b9440f',
      fondo: '#ffffff',
      info: '#504e4a',
      successo: '#1d5a35',
      attenzione: '#6b4b00',
      pericolo: '#b91c1c',
      neutro: '#d3d0c9',
    })
  })

  it('in scuro usa i valori IgniCraft', () => {
    expect(coloriGrafico('scuro')).toEqual({
      testo: '#96938c',
      griglia: '#2c2b27',
      primario: '#ff8a5c',
      fondo: '#1d1d1a',
      info: '#bdbab3',
      successo: '#c4ecd2',
      attenzione: '#ffe9a8',
      pericolo: '#f87171',
      neutro: '#4a4843',
    })
  })

  it('nessun colore del vecchio teal e del blu', () => {
    for (const tema of ['chiaro', 'scuro'] as const) {
      const valori = Object.values(coloriGrafico(tema))
      expect(valori).not.toContain('#0f766e')
      expect(valori).not.toContain('#1d4ed8')
    }
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
