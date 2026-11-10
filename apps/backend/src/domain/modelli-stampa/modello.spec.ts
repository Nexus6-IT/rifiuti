import { normalizzaModello, validaModello, type DatiModelloStampa } from './modello'

const PNG = Buffer.from('89504e470d0a1a0a0000000d', 'hex').toString('base64')

const base = (o: Partial<DatiModelloStampa> = {}): DatiModelloStampa => ({
  nome: 'Modello FIR',
  ambito: 'FIR',
  copie: 2,
  testoIntestazione: null,
  testoPiePagina: null,
  colorePrimario: '#112233',
  coloreSecondario: '#445566',
  logoBase64: null,
  ...o,
})

describe('modello di stampa (dominio)', () => {
  it('normalizza: nome e testi tagliati, testi vuoti a null, logo riportato a base64 puro', () => {
    const n = normalizzaModello(
      base({
        nome: '  Ditta  ',
        testoIntestazione: '  Titolo ',
        testoPiePagina: '   ',
        logoBase64: `data:image/png;base64,${PNG}`,
      })
    )
    expect(n).toMatchObject({
      nome: 'Ditta',
      testoIntestazione: 'Titolo',
      testoPiePagina: null,
      logoBase64: PNG,
    })
  })

  it('un modello valido non ha errori', () => {
    expect(validaModello(normalizzaModello(base({ logoBase64: PNG })))).toEqual([])
  })

  it.each([
    [{ nome: '' }, /nome/i],
    [{ nome: 'x'.repeat(101) }, /nome/i],
    [{ ambito: 'ALTRO' as never }, /ambito/i],
    [{ copie: 0 }, /copie/i],
    [{ copie: 5 }, /copie/i],
    [{ copie: 1.5 }, /copie/i],
    [{ colorePrimario: 'rosso' }, /color/i],
    [{ coloreSecondario: '#12345' }, /color/i],
    [{ testoIntestazione: 'x'.repeat(501) }, /intestazione/i],
    [{ testoPiePagina: 'x'.repeat(501) }, /pi[eè] di pagina/i],
    [{ logoBase64: Buffer.from('non e un png').toString('base64') }, /logo/i],
  ])('rifiuta %j', (campo, atteso) => {
    const errori = validaModello(normalizzaModello(base(campo as Partial<DatiModelloStampa>)))
    expect(errori.join(' ')).toMatch(atteso)
  })
})
