import {
  ETICHETTE_CODICE_RINNOVO,
  ETICHETTE_ESIGIBILITA,
  ETICHETTE_FREQUENZA,
  ETICHETTE_STATO_CONTRATTO,
  ETICHETTE_UNITA_VALIDITA,
  OPZIONI_ESIGIBILITA,
  TRANSIZIONI_STATO,
} from './vocabolario-clienti'

describe('vocabolario clienti', () => {
  it('esigibilità: Immediata, Differita, Split payment', () => {
    expect(ETICHETTE_ESIGIBILITA).toEqual({
      IMMEDIATA: 'Immediata',
      DIFFERITA: 'Differita',
      SCISSIONE: 'Split payment',
    })
    expect(OPZIONI_ESIGIBILITA.map(o => o.value)).toEqual(['IMMEDIATA', 'DIFFERITA', 'SCISSIONE'])
  })

  it('stati di D8 e transizioni', () => {
    expect(ETICHETTE_STATO_CONTRATTO.SOSPESO_MOVIMENTI).toBe('Sospeso (solo movimenti)')
    expect(TRANSIZIONI_STATO.BOZZA).toEqual(['ATTIVO'])
    expect(TRANSIZIONI_STATO.ANNULLATO).toEqual([])
  })

  it('frequenze, unità della validità e codici di rinnovo (solo S e N)', () => {
    expect(Object.keys(ETICHETTE_FREQUENZA).length).toBe(6)
    expect(ETICHETTE_UNITA_VALIDITA).toEqual({ A: 'Anni', S: 'Semestri', M: 'Mesi', G: 'Giorni' })
    expect(Object.keys(ETICHETTE_CODICE_RINNOVO)).toEqual(['S', 'N'])
  })
})
