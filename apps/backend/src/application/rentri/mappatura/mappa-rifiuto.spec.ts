import {
  mappaRifiuto,
  ValoreNonTraducibilePerRentriError,
  type DatiRifiutoFIR,
} from './mappa-rifiuto'

describe('mappaRifiuto', () => {
  const rifiutoBase: DatiRifiutoFIR = {
    cerCode: '20.03.01',
    wastePhysicalState: 'Solido',
    wasteDescription: 'Rifiuti urbani non differenziati',
  }

  it('mappa un rifiuto completo nel modello RENTRI atteso', () => {
    const risultato = mappaRifiuto(rifiutoBase, 'U')

    expect(risultato).toEqual({
      codice_eer: '20.03.01',
      provenienza: 'U',
      stato_fisico: 'S',
      descrizione: 'Rifiuti urbani non differenziati',
    })
  })

  it('mappa la provenienza "S" (speciale) quando fornita esplicitamente', () => {
    const risultato = mappaRifiuto(rifiutoBase, 'S')
    expect(risultato.provenienza).toBe('S')
  })

  it('omette "descrizione" quando il rifiuto non ne ha una e il codice EER non è .99', () => {
    const risultato = mappaRifiuto(
      { cerCode: '20.03.01', wastePhysicalState: 'Solido', wasteDescription: null },
      'U'
    )
    expect(risultato).not.toHaveProperty('descrizione')
  })

  describe('tabella di traduzione dello stato fisico', () => {
    const casi: Array<[string, 'SP' | 'S' | 'FP' | 'L' | 'VS']> = [
      ['Polvere', 'SP'],
      ['SOLIDO_POLVERULENTO', 'SP'],
      ['in polvere o pulverulento', 'SP'],
      ['Solido', 'S'],
      ['SOLIDO', 'S'],
      ['SOLIDO_NON_POLVERULENTO', 'S'],
      ['Fangoso', 'FP'],
      ['FANGOSO_PALABILE', 'FP'],
      ['Liquido', 'L'],
      ['LIQUIDO', 'L'],
      ['Vischioso sciropposo', 'VS'],
      ['VISCOSO_SCIROPPOSO', 'VS'],
    ]

    it.each(casi)('traduce "%s" in "%s"', (valoreInterno, codiceAtteso) => {
      const risultato = mappaRifiuto(
        { cerCode: '20.03.01', wastePhysicalState: valoreInterno, wasteDescription: 'x' },
        'U'
      )
      expect(risultato.stato_fisico).toBe(codiceAtteso)
    })
  })

  describe('fail-closed su stato fisico sconosciuto', () => {
    it('solleva ValoreNonTraducibilePerRentriError per un valore non in tabella', () => {
      expect(() =>
        mappaRifiuto(
          { cerCode: '20.03.01', wastePhysicalState: 'Gassoso', wasteDescription: 'x' },
          'U'
        )
      ).toThrow(ValoreNonTraducibilePerRentriError)
    })

    it('non applica alcun default quando lo stato fisico manca', () => {
      expect(() =>
        mappaRifiuto({ cerCode: '20.03.01', wastePhysicalState: undefined }, 'U')
      ).toThrow(ValoreNonTraducibilePerRentriError)
    })

    it("il messaggio d'errore riporta il valore ricevuto e i codici ammessi", () => {
      try {
        mappaRifiuto(
          { cerCode: '20.03.01', wastePhysicalState: 'Misto', wasteDescription: 'x' },
          'U'
        )
        fail('doveva sollevare un errore')
      } catch (errore) {
        expect(errore).toBeInstanceOf(ValoreNonTraducibilePerRentriError)
        expect((errore as Error).message).toContain('Misto')
        expect((errore as Error).message).toContain('SP')
        expect((errore as Error).message).toContain('VS')
      }
    })
  })

  describe('fail-closed su provenienza mancante', () => {
    it('solleva errore quando la provenienza è undefined', () => {
      expect(() => mappaRifiuto(rifiutoBase, undefined)).toThrow(ValoreNonTraducibilePerRentriError)
    })

    it('solleva errore quando la provenienza è null', () => {
      expect(() => mappaRifiuto(rifiutoBase, null)).toThrow(ValoreNonTraducibilePerRentriError)
    })

    it('solleva errore su un valore di provenienza non ammesso', () => {
      expect(() => mappaRifiuto(rifiutoBase, 'X' as unknown as 'U' | 'S')).toThrow(
        ValoreNonTraducibilePerRentriError
      )
    })
  })

  describe('fail-closed su descrizione mancante con EER .99', () => {
    it('richiede la descrizione quando il codice EER termina con .99', () => {
      expect(() =>
        mappaRifiuto(
          { cerCode: '20.01.99', wastePhysicalState: 'Solido', wasteDescription: undefined },
          'U'
        )
      ).toThrow(ValoreNonTraducibilePerRentriError)
    })

    it('richiede la descrizione anche quando è una stringa vuota o solo spazi', () => {
      expect(() =>
        mappaRifiuto(
          { cerCode: '20.01.99', wastePhysicalState: 'Solido', wasteDescription: '   ' },
          'U'
        )
      ).toThrow(ValoreNonTraducibilePerRentriError)
    })

    it('accetta un EER .99 quando la descrizione è presente', () => {
      const risultato = mappaRifiuto(
        {
          cerCode: '20.01.99',
          wastePhysicalState: 'Solido',
          wasteDescription: 'Rifiuto non altrimenti specificato',
        },
        'U'
      )
      expect(risultato.descrizione).toBe('Rifiuto non altrimenti specificato')
    })

    it('non richiede la descrizione per un codice EER che non è .99', () => {
      const risultato = mappaRifiuto(
        { cerCode: '20.01.08', wastePhysicalState: 'Solido', wasteDescription: undefined },
        'U'
      )
      expect(risultato).not.toHaveProperty('descrizione')
    })
  })
})
