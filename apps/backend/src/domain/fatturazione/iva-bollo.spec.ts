import { riepiloghiIva, rigaSpeseIncasso, valutaBollo } from './iva-bollo'
import type { CodiceIvaDaFatturare, RigaDocumentoCalcolata, RiepilogoIvaCalcolato } from './tipi'

const iva = (
  id: string,
  aliquota: string,
  natura: string | null,
  descrizione = id
): CodiceIvaDaFatturare => ({
  id,
  versione: 1,
  aliquota,
  natura,
  descrizione,
})
const C22 = iva('c22', '22.00', null, 'IVA 22%')
const N22 = iva('n22', '0.00', 'N2.2', 'Non soggetto')
const N1 = iva('n1', '0.00', 'N1', 'Escluso art. 15')
const mappa = (...c: CodiceIvaDaFatturare[]) => new Map(c.map(x => [x.id, x]))

const riga = (c: CodiceIvaDaFatturare, totale: string): RigaDocumentoCalcolata => ({
  numeroLinea: 1,
  tipoRiga: 'FISSO',
  legameId: null,
  rigaLegameId: null,
  rigaAddebitoId: null,
  descrizione: 'x',
  dataMovimento: null,
  cerCode: null,
  numeroFir: null,
  quantita: '1.00',
  unitaMisura: null,
  prezzoUnitario: totale,
  sconto: null,
  importoLordo: totale,
  importoSconto: '0.00',
  prezzoTotale: totale,
  codiceIvaId: c.id,
  aliquotaIva: c.aliquota,
  naturaIva: c.natura,
})

const riep = (natura: string | null, imponibile: string): RiepilogoIvaCalcolato => ({
  aliquota: '0.00',
  natura,
  imponibile,
  imposta: '0.00',
  esigibilita: 'I',
  riferimentoNormativo: null,
})

describe('riepiloghiIva', () => {
  it("calcola l'imposta sul totale della coppia, non sulla somma delle righe", () => {
    const r = riepiloghiIva(
      [riga(C22, '10.01'), riga(C22, '10.01'), riga(C22, '10.01')],
      'I',
      mappa(C22)
    )
    expect(r.errori).toEqual([])
    expect(r.riepiloghi).toHaveLength(1)
    expect(r.riepiloghi[0]).toMatchObject({ imponibile: '30.03', imposta: '6.61' })
  })

  it('riga N2.2 a zero e riga 22%: due riepiloghi', () => {
    const r = riepiloghiIva([riga(N22, '5.00'), riga(C22, '10.00')], 'I', mappa(N22, C22))
    expect(r.riepiloghi).toHaveLength(2)
    expect(r.riepiloghi.find(x => x.natura === 'N2.2')).toMatchObject({
      imponibile: '5.00',
      imposta: '0.00',
    })
  })

  it.each(['N2', 'N3', 'N6'])('natura %s: NATURA_NON_AMMESSA', n => {
    const c = iva('g', '0.00', n)
    const r = riepiloghiIva([riga(c, '5.00'), riga(c, '1.00')], 'I', mappa(c))
    expect(r.errori).toEqual([{ codice: 'NATURA_NON_AMMESSA', dettaglio: n }])
  })

  it('riferimento normativo troncato a 100 ed esigibilita sul riepilogo', () => {
    const c = iva('l', '22.00', null, 'a'.repeat(150))
    const r = riepiloghiIva([riga(c, '10.00')], 'S', mappa(c))
    expect(r.riepiloghi[0].riferimentoNormativo).toBe('a'.repeat(100))
    expect(r.riepiloghi[0].esigibilita).toBe('S')
  })
})

describe('valutaBollo', () => {
  const spesa = { importo: '2.00', codiceIva: N1 }
  it('N4 77.47 non dovuto, 77.48 dovuto 2.00', () => {
    expect(valutaBollo([riep('N4', '77.47')], '2026-11-05', null).dovuto).toBe(false)
    const v = valutaBollo([riep('N4', '77.48')], '2026-11-05', null)
    expect(v.dovuto).toBe(true)
    expect(v.importo).toBe('2.00')
  })
  it('dovuto senza spesa: avviso e nessuna riga', () => {
    const v = valutaBollo([riep('N4', '100.00')], '2026-11-05', null)
    expect(v.avvisi).toEqual([{ codice: 'BOLLO_NON_ADDEBITATO' }])
    expect(v.rigaBollo).toBeNull()
  })
  it('dovuto con spesa e codice N1: riga BOLLO', () => {
    const v = valutaBollo([riep('N4', '100.00')], '2026-11-05', spesa)
    expect(v.errori).toEqual([])
    expect(v.rigaBollo).toMatchObject({
      tipoRiga: 'BOLLO',
      prezzoTotale: '2.00',
      naturaIva: 'N1',
      codiceIvaId: 'n1',
    })
  })
  it('spesa 2.50 con codice N1: la riga BOLLO e da 2.00 (importo del bollo)', () => {
    const v = valutaBollo([riep('N4', '100.00')], '2026-11-05', { importo: '2.50', codiceIva: N1 })
    expect(v.importo).toBe('2.00')
    expect(v.rigaBollo).toMatchObject({
      prezzoTotale: '2.00',
      importoLordo: '2.00',
      prezzoUnitario: '2.00',
    })
  })
  it('caso limite: coi riepiloghi che includono gia la riga BOLLO N1 la soglia si sposta', () => {
    expect(valutaBollo([riep('N4', '76.00')], '2026-11-05', null).dovuto).toBe(false)
    expect(valutaBollo([riep('N4', '76.00'), riep('N1', '2.00')], '2026-11-05', null).dovuto).toBe(
      true
    )
  })
  it('spesa senza codice IVA o con natura non N1: errore', () => {
    expect(
      valutaBollo([riep('N4', '100.00')], '2026-11-05', { importo: '2.00', codiceIva: null })
        .errori[0].codice
    ).toBe('SPESA_SENZA_CODICE_IVA')
    const v = valutaBollo([riep('N4', '100.00')], '2026-11-05', { importo: '2.00', codiceIva: N22 })
    expect(v.errori).toEqual([
      { codice: 'NATURA_NON_AMMESSA', dettaglio: 'bollo: serve un codice IVA con natura N1' },
    ])
    expect(v.rigaBollo).toBeNull()
  })
  it('solo imponibile al 22%: non dovuto', () => {
    expect(
      valutaBollo([{ ...riep(null, '500.00'), aliquota: '22.00' }], '2026-11-05', spesa).dovuto
    ).toBe(false)
  })
})

describe('rigaSpeseIncasso', () => {
  it('2.50 con 3 rate: riga 7.50', () => {
    const r = rigaSpeseIncasso({ descrizione: 'Spese incasso', importo: '2.50', codiceIva: C22 }, 3)
    expect(r.riga).toMatchObject({
      tipoRiga: 'SPESA_INCASSO',
      prezzoTotale: '7.50',
      descrizione: 'Spese incasso',
    })
  })
  it('senza codice IVA: errore', () => {
    expect(
      rigaSpeseIncasso({ descrizione: 's', importo: '2.50', codiceIva: null }, 1).errori[0].codice
    ).toBe('SPESA_SENZA_CODICE_IVA')
  })
  it('importo zero o assente: nessuna riga', () => {
    expect(rigaSpeseIncasso({ descrizione: 's', importo: '0.00', codiceIva: null }, 2)).toEqual({
      riga: null,
      errori: [],
    })
    expect(rigaSpeseIncasso(null, 2)).toEqual({ riga: null, errori: [] })
  })
})
