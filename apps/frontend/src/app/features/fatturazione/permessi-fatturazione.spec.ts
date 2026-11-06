import { permessiFatturazione } from './permessi-fatturazione'

describe('permessiFatturazione', () => {
  it('VIEWER vede soltanto', () => {
    expect(permessiFatturazione('VIEWER')).toEqual({
      vede: true,
      prepara: false,
      rendeDefinitiva: false,
      scaricaXml: false,
      imposta: false,
    })
  })

  it('OPERATOR prepara ma non rende definitiva né scarica XML', () => {
    expect(permessiFatturazione('OPERATOR')).toEqual({
      vede: true,
      prepara: true,
      rendeDefinitiva: false,
      scaricaXml: false,
      imposta: false,
    })
  })

  for (const ruolo of ['ADMIN', 'SUPER_ADMIN']) {
    it(`${ruolo} può tutto`, () => {
      expect(permessiFatturazione(ruolo)).toEqual({
        vede: true,
        prepara: true,
        rendeDefinitiva: true,
        scaricaXml: true,
        imposta: true,
      })
    })
  }

  for (const ruolo of [null, undefined, '', 'GUEST', 'admin']) {
    it(`ruolo ${JSON.stringify(ruolo)}: nessuna azione`, () => {
      expect(Object.values(permessiFatturazione(ruolo)).every(x => x === false)).toBeTrue()
    })
  }
})
