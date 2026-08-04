import { ordinaAziendePerGruppo } from './layout.component'

describe('ordinaAziendePerGruppo', () => {
  it('mette ogni figlia sotto la propria madre e la marca come annidata', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'beta', name: 'Beta Srl', parentTenantId: 'madre' },
      { id: 'madre', name: 'Gruppo Madre Srl', parentTenantId: null },
      { id: 'alfa', name: 'Alfa Srl', parentTenantId: 'madre' },
    ])

    expect(risultato.map(a => a.id)).toEqual(['madre', 'alfa', 'beta'])
    expect(risultato.map(a => a.annidata)).toEqual([false, true, true])
  })

  it('lascia in elenco piatto le aziende senza gruppo', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'due', name: 'Due Srl', parentTenantId: null },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id)).toEqual(['due', 'uno'])
    expect(risultato.every(a => !a.annidata)).toBe(true)
  })

  it('non perde le figlie la cui madre non e\' accessibile all\'utente', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'orfana', name: 'Orfana Srl', parentTenantId: 'madre-non-visibile' },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id).sort()).toEqual(['orfana', 'uno'])
    expect(risultato.find(a => a.id === 'orfana')?.annidata).toBe(false)
  })
})
