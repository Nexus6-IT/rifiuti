import { decodificaRegistri } from './registri'

// docs/movimenti.md §2.2: REG1..REG4 + PROT1..PROT4.
describe('decodificaRegistri', () => {
  it('coppie registro/protocollo senza i vuoti', () => {
    expect(decodificaRegistri(['0002', '', '0003', ''], ['000003', '', '000010', ''])).toEqual({
      ok: true,
      valore: [
        { registro: '0002', protocollo: 3 },
        { registro: '0003', protocollo: 10 },
      ],
    })
  })

  it('registro senza protocollo e ammesso; protocollo 0 = non assegnato', () => {
    expect(decodificaRegistri(['0001', '0002'], ['', '000000'])).toEqual({
      ok: true,
      valore: [
        { registro: '0001', protocollo: null },
        { registro: '0002', protocollo: null },
      ],
    })
  })

  it('tutto vuoto o null', () => {
    expect(decodificaRegistri([null, ''], [null])).toEqual({ ok: true, valore: [] })
  })

  it('protocollo senza registro', () => {
    expect(decodificaRegistri(['', '0002'], ['000001', ''])).toMatchObject({
      ok: false,
      codice: 'REGISTRO_PROTOCOLLO_INCOERENTE',
    })
  })

  it.each([['12AB'], ['1234567'], ['-1']])('protocollo non numerico %s', p => {
    expect(decodificaRegistri(['0002'], [p])).toMatchObject({
      ok: false,
      codice: 'PROTOCOLLO_NON_NUMERICO',
    })
  })
})
