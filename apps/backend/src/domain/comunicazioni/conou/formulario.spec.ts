import { scomponiNumeroFir } from './formulario'

describe('scomponiNumeroFir (calcolaformu di WinWaste)', () => {
  it('numero con serie, numero e anno a 2 cifre', () => {
    expect(scomponiNumeroFir('ABC123/25')).toEqual({ serie: 'ABC', numero: '123', anno: '2025' })
  })
  it('anno a 4 cifre', () => {
    expect(scomponiNumeroFir('123/2026')).toEqual({ serie: '', numero: '123', anno: '2026' })
  })
  it('solo cifre: niente anno', () => {
    expect(scomponiNumeroFir('000456')).toEqual({ serie: '', numero: '000456', anno: '' })
  })
  it('vuoto o assente', () => {
    expect(scomponiNumeroFir('')).toEqual({ serie: '', numero: '', anno: '' })
    expect(scomponiNumeroFir(null)).toEqual({ serie: '', numero: '', anno: '' })
    expect(scomponiNumeroFir('  ')).toEqual({ serie: '', numero: '', anno: '' })
  })
  it('anno fuori da 2020-2099: anno vuoto e numero = tutto il resto', () => {
    expect(scomponiNumeroFir('AB123/19')).toEqual({ serie: 'AB', numero: '123/19', anno: '' })
    expect(scomponiNumeroFir('AB123/2100')).toEqual({ serie: 'AB', numero: '123/2100', anno: '' })
    expect(scomponiNumeroFir('AB123/xyz')).toEqual({ serie: 'AB', numero: '123/xyz', anno: '' })
  })
  it('formato RENTRI con lettere, cifre e anno', () => {
    expect(scomponiNumeroFir('FIR000012345/24')).toEqual({
      serie: 'FIR',
      numero: '000012345',
      anno: '2024',
    })
  })
  it('serie oltre 6 o numero oltre 10: taglio fisso a 6 caratteri', () => {
    expect(scomponiNumeroFir('ABCDEFGH12/25')).toEqual({
      serie: 'ABCDEF',
      numero: 'GH12/25',
      anno: '2025',
    })
    expect(scomponiNumeroFir('1234567890123/25')).toEqual({
      serie: '123456',
      numero: '7890123/25',
      anno: '2025',
    })
  })
  it('le lettere minuscole non sono serie (confronto binario come in WinWaste)', () => {
    expect(scomponiNumeroFir('abc123/25')).toEqual({ serie: '', numero: 'abc123', anno: '2025' })
  })
})
