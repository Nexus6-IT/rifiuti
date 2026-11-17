import {
  NUMERO_CER_TABELLA_CONOU,
  PRODOTTI_CONOU,
  prodottiAmmessiPerCer,
  prodottoPredefinito,
} from './prodotti-per-cer'

describe('prodotti CONOU per CER (OLIOtiporif di WinWaste)', () => {
  it('contiene i CER della tabella di WinWaste (65 voci contate nel decompilato; il documento dice 64)', () => {
    expect(NUMERO_CER_TABELLA_CONOU).toBe(65)
  })

  it('un CER con piu prodotti ammette l’insieme ordinato, senza predefinito', () => {
    expect(prodottiAmmessiPerCer('160113')).toEqual(['A', 'B', 'C', 'E', 'G'])
    expect(prodottiAmmessiPerCer('130101')).toEqual(['A', 'B', 'E']) // sorgente: EAB
    expect(prodottoPredefinito('160113')).toBeNull()
  })

  it('un CER con un solo prodotto lo propone come predefinito', () => {
    expect(prodottiAmmessiPerCer('130205')).toEqual(['A'])
    expect(prodottoPredefinito('130205')).toBe('A')
    expect(prodottoPredefinito('050103')).toBe('C')
  })

  it('accetta il CER scritto con spazi e asterisco', () => {
    expect(prodottiAmmessiPerCer('13 02 05*')).toEqual(['A'])
  })

  it('CER fuori tabella: nessun prodotto, nessun predefinito', () => {
    expect(prodottiAmmessiPerCer('200301')).toEqual([])
    expect(prodottoPredefinito('200301')).toBeNull()
  })

  it('tutti i prodotti della tabella sono tra quelli ammessi dal tracciato', () => {
    const cer = ['080319', '110111', '130301', '190207', '200126']
    for (const c of cer) {
      for (const p of prodottiAmmessiPerCer(c)) expect(PRODOTTI_CONOU).toContain(p)
    }
  })
})
