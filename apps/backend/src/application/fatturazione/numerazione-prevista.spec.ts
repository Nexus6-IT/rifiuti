import { conQuantiSalvati, numerazioneAllaLettura } from './numerazione-prevista'

const salvata = [
  { registroIvaId: 'r1', codiceRegistro: 'A', da: '15/A', a: '17/A' },
  { registroIvaId: 'r2', codiceRegistro: 'B', da: '1', a: '2' },
]

describe('numerazioneAllaLettura', () => {
  it('toglie un documento: quanti e a scendono, da e suffisso restano', () => {
    const r = numerazioneAllaLettura(
      salvata,
      new Map([
        ['r1', 2],
        ['r2', 2],
      ])
    )
    expect(r[0]).toEqual({ ...salvata[0], a: '16/A', quanti: 2 })
    expect(r[1]).toEqual({ ...salvata[1], quanti: 2 })
  })

  it('un registro senza candidati sparisce; tutti esclusi: vuota', () => {
    expect(numerazioneAllaLettura(salvata, new Map([['r2', 1]]))).toEqual([
      { ...salvata[1], a: '1', quanti: 1 },
    ])
    expect(numerazioneAllaLettura(salvata, new Map())).toEqual([])
  })

  it('più candidati di prima (bozze aggiunte): a sale', () => {
    expect(numerazioneAllaLettura([salvata[0]], new Map([['r1', 5]]))[0]).toMatchObject({
      a: '19/A',
      quanti: 5,
    })
  })
})

describe('conQuantiSalvati', () => {
  it('ricava quanti dai numeri salvati', () => {
    expect(conQuantiSalvati(salvata).map(v => v.quanti)).toEqual([3, 2])
  })
})

describe('numerazioneAllaLettura con il contatore attuale', () => {
  it('da e a partono dal contatore corrente, con il suffisso della serie', () => {
    const r = numerazioneAllaLettura(
      salvata,
      new Map([
        ['r1', 2],
        ['r2', 3],
      ]),
      new Map([
        ['r1', { ultimoNumero: 99, suffisso: '/B' }],
        ['r2', { ultimoNumero: 0, suffisso: null }],
      ])
    )
    expect(r[0]).toEqual({ ...salvata[0], da: '100/B', a: '101/B', quanti: 2 })
    expect(r[1]).toEqual({ ...salvata[1], da: '1', a: '3', quanti: 3 })
  })
})
