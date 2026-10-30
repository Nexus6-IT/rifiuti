import { COLORI_CONTRASSEGNO, contrassegnoAzienda, inizialiAzienda } from './contrassegno-azienda'

describe('contrassegnoAzienda', () => {
  it('inizialiAzienda: prime lettere delle prime due parole significative', () => {
    expect(inizialiAzienda('Officine Bresciani S.r.l.')).toBe('OB')
    expect(inizialiAzienda('  tipografia   pavan ')).toBe('TP')
  })

  it('inizialiAzienda: ignora la forma giuridica e la punteggiatura', () => {
    expect(inizialiAzienda('Ecometalli S.p.A.')).toBe('EC')
    expect(inizialiAzienda('ACME SRL')).toBe('AC')
  })

  it('inizialiAzienda: nome vuoto o assente dà "AZ"', () => {
    expect(inizialiAzienda('')).toBe('AZ')
    expect(inizialiAzienda(null)).toBe('AZ')
  })

  it('lo stesso id dà sempre lo stesso colore', () => {
    const a = contrassegnoAzienda('tenant-123', 'Officine Bresciani')
    const b = contrassegnoAzienda('tenant-123', 'Nome cambiato')
    expect(a.colore).toBe(b.colore)
  })

  it('il colore viene dalla tavolozza fissa', () => {
    for (const id of ['a', 'b', 'c', 'tenant-1', 'tenant-2', 'f3a1c9e0-7b2d']) {
      expect(COLORI_CONTRASSEGNO).toContain(contrassegnoAzienda(id, 'X').colore)
    }
  })

  it('id diversi si distribuiscono su più colori', () => {
    const colori = new Set(
      Array.from({ length: 40 }, (_, i) => contrassegnoAzienda(`tenant-${i}`, 'X').colore)
    )
    expect(colori.size).toBeGreaterThan(4)
  })

  it('senza id usa il nome per scegliere il colore', () => {
    expect(contrassegnoAzienda(null, 'Officine Bresciani').colore).toBe(
      contrassegnoAzienda(null, 'Officine Bresciani').colore
    )
    expect(contrassegnoAzienda(null, 'Officine Bresciani').iniziali).toBe('OB')
  })
})
