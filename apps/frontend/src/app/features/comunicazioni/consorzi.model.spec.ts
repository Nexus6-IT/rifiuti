import {
  descriviCer,
  descriviRegola,
  etichettaConsorzio,
  etichetteMovimento,
  type MarcaturaMovimento,
  type RegolaConsorzio,
} from './consorzi.model'

const regola = (o: Partial<RegolaConsorzio> = {}): RegolaConsorzio => ({
  id: 'r1',
  consorzio: 'CONOU',
  verso: null,
  cer: '13',
  cerEsatto: false,
  causaleCodice: null,
  registroId: null,
  attiva: true,
  validaDal: '2026-01-01',
  sistema: false,
  inVigore: true,
  ...o,
})

describe('consorzi.model', () => {
  it('descriviCer: prefisso con le xx, codice esatto spaziato', () => {
    expect(descriviCer('13', false)).toBe('13 xx xx')
    expect(descriviCer('1606', false)).toBe('16 06 xx')
    expect(descriviCer('160601', true)).toBe('16 06 01')
  })

  it('etichettaConsorzio', () => {
    expect(etichettaConsorzio('CONOU')).toBe('CONOU')
    expect(etichettaConsorzio('COREPLA')).toBe('Corepla')
  })

  it('descriviRegola: CER, verso, causale e stato', () => {
    expect(descriviRegola(regola())).toBe('CER 13 xx xx, carichi e scarichi')
    expect(descriviRegola(regola({ verso: 'CARICO', causaleCodice: 'RACCOLTA' }))).toBe(
      'CER 13 xx xx, solo carichi, causale RACCOLTA'
    )
    expect(descriviRegola(regola({ verso: 'SCARICO', cer: '160601', cerEsatto: true }))).toBe(
      'CER 16 06 01, solo scarichi'
    )
  })

  it('etichetteMovimento: consorzi marcati, con «manuale», e le esclusioni', () => {
    const m: MarcaturaMovimento = {
      marcature: [
        { consorzio: 'CONOU', origine: 'REGOLA' },
        { consorzio: 'COREPLA', origine: 'MANUALE' },
      ],
      esclusi: ['COBAT'],
    }
    expect(etichetteMovimento(m)).toEqual([
      { consorzio: 'CONOU', testo: 'CONOU', manuale: false, escluso: false },
      { consorzio: 'COREPLA', testo: 'Corepla (manuale)', manuale: true, escluso: false },
    ])
    expect(etichetteMovimento(undefined)).toEqual([])
  })
})
