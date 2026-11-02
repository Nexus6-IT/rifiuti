import { partitaIvaUnica, partitaIvaValida } from './anagrafiche-di-test'

/** Controllo della cifra di controllo, scritto qui in modo indipendente dal generatore. */
function checksumValido(piva: string): boolean {
  if (!/^\d{11}$/.test(piva)) return false
  let somma = 0
  for (let i = 0; i < 11; i++) {
    let c = Number(piva[i])
    if (i % 2 === 1) {
      c *= 2
      if (c > 9) c -= 9
    }
    somma += c
  }
  return somma % 10 === 0
}

describe('partitaIvaUnica', () => {
  it('10.000 chiamate consecutive danno valori tutti distinti e con checksum valido', () => {
    const viste = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      const piva = partitaIvaUnica()
      expect(checksumValido(piva)).toBe(true)
      viste.add(piva)
    }
    expect(viste.size).toBe(10_000)
  })
})

describe('partitaIvaValida (deterministica)', () => {
  it('lo stesso seme restituisce sempre la stessa P.IVA, semi diversi P.IVA diverse', () => {
    expect(partitaIvaValida(42)).toBe(partitaIvaValida(42))
    expect(partitaIvaValida(42)).not.toBe(partitaIvaValida(43))
  })

  it('valori fissi invariati e checksum valido', () => {
    expect(partitaIvaValida(7)).toBe('00000070003')
    expect(checksumValido(partitaIvaValida(7))).toBe(true)
    expect(checksumValido(partitaIvaValida(9_999_999))).toBe(true)
  })
})
