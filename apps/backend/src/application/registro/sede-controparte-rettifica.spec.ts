import { sedeControparteRettifica } from './sede-controparte-rettifica'

describe('sedeControparteRettifica (D3)', () => {
  const SEDE = '11111111-1111-4111-8111-111111111111'
  const ALTRA = '22222222-2222-4222-8222-222222222222'
  const originale = {
    counterpartSedeId: SEDE as string | null,
    counterpartName: 'Comune di Calliano',
    counterpartAddress: 'Via Roma 1, Calliano (TN)',
  }
  const stessiTesti = {
    counterpartName: 'Comune di Calliano',
    counterpartAddress: 'Via Roma 1, Calliano (TN)',
  }

  it('una stringa esplicita si usa (anche se i testi cambiano)', () => {
    expect(
      sedeControparteRettifica(originale, {
        counterpartSedeId: ALTRA,
        counterpartName: 'Altro',
        counterpartAddress: 'Altrove',
      })
    ).toBe(ALTRA)
  })

  it('null esplicito: azzeramento, nessuna sede', () => {
    expect(
      sedeControparteRettifica(originale, { counterpartSedeId: null, ...stessiTesti })
    ).toBeNull()
  })

  it('assente con nome e indirizzo uguali: si propaga la sede del predecessore', () => {
    expect(sedeControparteRettifica(originale, stessiTesti)).toBe(SEDE)
  })

  it('assente con nome e indirizzo uguali a meno di maiuscole e spazi: si propaga', () => {
    expect(
      sedeControparteRettifica(originale, {
        counterpartName: '  COMUNE   di  calliano ',
        counterpartAddress: 'via roma 1,   Calliano (TN)  ',
      })
    ).toBe(SEDE)
  })

  it('assente con nome cambiato: null', () => {
    expect(
      sedeControparteRettifica(originale, { ...stessiTesti, counterpartName: 'Comune di Trento' })
    ).toBeNull()
  })

  it('assente con indirizzo cambiato: null', () => {
    expect(
      sedeControparteRettifica(originale, { ...stessiTesti, counterpartAddress: 'Via Dante 2' })
    ).toBeNull()
  })

  it('assente con testi tolti (undefined) mentre il predecessore li aveva: null', () => {
    expect(sedeControparteRettifica(originale, {})).toBeNull()
  })

  it('predecessore senza sede: null (niente da propagare)', () => {
    expect(
      sedeControparteRettifica({ ...originale, counterpartSedeId: null }, stessiTesti)
    ).toBeNull()
  })

  it('testi assenti da entrambe le parti e sede presente: si propaga', () => {
    expect(
      sedeControparteRettifica(
        { counterpartSedeId: SEDE, counterpartName: null, counterpartAddress: null },
        {}
      )
    ).toBe(SEDE)
  })
})
