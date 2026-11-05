import { righeQuantitaMovimenti } from './righe-quantita'
import { legameDi, listinoDi } from './prova-fixture'

const periodo = { dal: '2026-11-01', al: '2026-11-30' }
const tt = (p = {}) => listinoDi({ id: 'tt', tipo: 'TT', prezzo: '0.02', ...p })
const run = (righe: ReturnType<typeof listinoDi>[], legami: ReturnType<typeof legameDi>[]) =>
  righeQuantitaMovimenti({ righe, legami, periodo })

describe('righeQuantitaMovimenti', () => {
  it('TT in KG su tre legami', () => {
    const e = run(
      [tt()],
      [
        legameDi({ quantitaMovimento: '1000' }),
        legameDi({ quantitaMovimento: '2500.5' }),
        legameDi({ quantitaMovimento: '499.5' }),
      ]
    )
    expect(e.righe).toHaveLength(1)
    expect(e.righe[0].tipoRiga).toBe('QUANTITA_MOVIMENTI')
    expect(e.righe[0].quantita).toBe('4000')
    expect(e.righe[0].prezzoTotale).toBe('80.00')
    expect(e.righe[0].legameId).toBeNull()
  })
  it('TT in TON', () => {
    const e = run(
      [tt({ unitaMisura: 'TON', prezzo: '15.00' })],
      [
        legameDi({ quantitaMovimento: '1.5', unitaMovimento: 'T' }),
        legameDi({ quantitaMovimento: '2500', unitaMovimento: 'KG' }),
      ]
    )
    expect(e.righe[0].quantita).toBe('4')
    expect(e.righe[0].prezzoTotale).toBe('60.00')
  })
  it('legame con due righe: conta una volta', () => {
    const l = legameDi({ quantitaMovimento: '1000' })
    const e = run([tt()], [l, { ...l, rigaLegameId: 'altra', tipo: 'V' }])
    expect(e.righe[0].quantita).toBe('1000')
  })
  it('TF: solo giorni festivi', () => {
    const e = run(
      [tt({ id: 'tf', tipo: 'TF', prezzo: '0.05' })],
      [
        legameDi({ dataMovimento: '2026-11-02', quantitaMovimento: '1000' }),
        legameDi({ dataMovimento: '2026-11-08', quantitaMovimento: '300' }),
        legameDi({ dataMovimento: '2026-12-08', quantitaMovimento: '200' }),
      ]
    )
    expect(e.righe[0].quantita).toBe('500')
    expect(e.righe[0].prezzoTotale).toBe('25.00')
  })
  it('elenco del principale: solo i legami di quell elenco', () => {
    const e = run(
      [tt()],
      [
        legameDi({ elencoId: 'E1', quantitaMovimento: '1000' }),
        legameDi({ elencoId: 'E2', quantitaMovimento: '500' }),
      ]
    )
    expect(e.righe[0].quantita).toBe('1000')
  })
  it('contratto allegato: tutti i legami del documento', () => {
    const e = run(
      [tt({ daAllegato: true, elencoId: 'EA' })],
      [
        legameDi({ elencoId: 'E1', quantitaMovimento: '1000' }),
        legameDi({ elencoId: 'E2', quantitaMovimento: '500' }),
      ]
    )
    expect(e.righe[0].quantita).toBe('1500')
  })
  it('nessun legame o nessun festivo: nessuna riga', () => {
    expect(run([tt()], []).righe).toHaveLength(0)
    expect(
      run([tt({ tipo: 'TF' })], [legameDi({ dataMovimento: '2026-11-02' })]).righe
    ).toHaveLength(0)
  })
  it('movimento in LT: UM_NON_UNIVOCA con dettaglio', () => {
    const e = run([listinoDi({ tipo: 'F' }), tt()], [legameDi({ unitaMovimento: 'LT' })])
    expect(e.righe).toHaveLength(0)
    expect(e.errori).toEqual([{ codice: 'UM_NON_UNIVOCA', dettaglio: 'TT riga 2' }])
  })
  it('TS, TT a prezzo speciale, NM: ignorate', () => {
    const e = run(
      [tt({ tipo: 'TS' }), tt({ prezzoSpeciale: true }), tt({ tipo: 'NM' })],
      [legameDi()]
    )
    expect(e.righe).toHaveLength(0)
    expect(e.errori).toHaveLength(0)
  })
  it('sconto 10', () => {
    const e = run([tt({ sconto: '10' })], [legameDi({ quantitaMovimento: '1000' })])
    expect(e.righe[0].importoLordo).toBe('20.00')
    expect(e.righe[0].importoSconto).toBe('2.00')
    expect(e.righe[0].prezzoTotale).toBe('18.00')
  })
})
