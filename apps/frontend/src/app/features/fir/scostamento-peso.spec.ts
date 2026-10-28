import {
  calcolaScostamentoPeso,
  SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO,
  testoAvvisoScostamento,
} from './scostamento-peso'

/** Stessi casi dello spec backend `domain/fir/scostamento-peso.spec.ts`. */
describe('calcolaScostamentoPeso (gemella del backend)', () => {
  it('soglia di avviso del 10%', () => {
    expect(SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO).toBe(10)
  })

  it('100 -> 100: nessuno scostamento', () => {
    expect(calcolaScostamentoPeso(100, 100, 'kg')).toEqual({
      differenza: 0,
      percentuale: 0,
      unita: 'kg',
      oltreSoglia: false,
    })
  })

  it('100 -> 110: +10% esatto, non oltre soglia', () => {
    const r = calcolaScostamentoPeso(100, 110, 'kg')
    expect(r.differenza).toBe(10)
    expect(r.percentuale).toBe(10)
    expect(r.oltreSoglia).toBe(false)
  })

  it('100 -> 110,01: oltre soglia, differenza 10,01', () => {
    const r = calcolaScostamentoPeso(100, 110.01, 'kg')
    expect(r.differenza).toBe(10.01)
    expect(r.oltreSoglia).toBe(true)
  })

  it('100 -> 89,99: oltre soglia', () => {
    const r = calcolaScostamentoPeso(100, 89.99, 'kg')
    expect(r.differenza).toBe(-10.01)
    expect(r.oltreSoglia).toBe(true)
  })

  it('100 -> 90: -10% esatto, non oltre soglia', () => {
    const r = calcolaScostamentoPeso(100, 90, 'kg')
    expect(r.differenza).toBe(-10)
    expect(r.percentuale).toBe(-10)
    expect(r.oltreSoglia).toBe(false)
  })

  it('33,3 -> 36,63: esattamente +10%, non oltre soglia (centesimi interi)', () => {
    expect(calcolaScostamentoPeso(33.3, 36.63, 'kg').oltreSoglia).toBe(false)
  })

  it('33,3 -> 36,64: oltre soglia', () => {
    expect(calcolaScostamentoPeso(33.3, 36.64, 'kg').oltreSoglia).toBe(true)
  })

  it('120 -> 150: +25%', () => {
    const r = calcolaScostamentoPeso(120, 150, 'kg')
    expect(r.differenza).toBe(30)
    expect(r.percentuale).toBe(25)
    expect(r.oltreSoglia).toBe(true)
  })

  it('percentuale arrotondata a 1 decimale', () => {
    expect(calcolaScostamentoPeso(120, 130, 'kg').percentuale).toBe(8.3)
  })

  it('dichiarata 0 o negativa: percentuale e oltreSoglia null', () => {
    for (const d of [0, -5]) {
      const r = calcolaScostamentoPeso(d, 50, 'kg')
      expect(r.percentuale).toBeNull()
      expect(r.oltreSoglia).toBeNull()
    }
  })

  it('differenza a 2 decimali e unità riportata', () => {
    const r = calcolaScostamentoPeso(0.1, 0.3, 'litri')
    expect(r.differenza).toBe(0.2)
    expect(r.unita).toBe('litri')
  })
})

describe('testoAvvisoScostamento', () => {
  it('compone il messaggio con segno, percentuale, dichiarata e unità', () => {
    const s = calcolaScostamentoPeso(120, 150, 'kg')
    const t = testoAvvisoScostamento(s, 120)
    expect(t).toContain('+25%')
    expect(t).toContain('(120 kg)')
    expect(t).toContain('puoi confermare, lo scostamento resta registrato sul FIR.')
  })
})
