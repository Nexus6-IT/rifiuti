import { BadRequestException } from '@nestjs/common'
import { creaAdattatoreFinto } from '../../../test-support/adattatore-finto'
import { RegistroAdattatori } from './registro-adattatori'

describe('RegistroAdattatori', () => {
  it('trova un adattatore per codice e li elenca tutti', () => {
    const a = creaAdattatoreFinto({ codice: 'AAA' })
    const b = creaAdattatoreFinto({ codice: 'BBB' })
    const r = new RegistroAdattatori([a, b])
    expect(r.trova('BBB')).toBe(b)
    expect(r.tutti().map(x => x.codice)).toEqual(['AAA', 'BBB'])
  })

  it('codice sconosciuto: 400 ADATTATORE_SCONOSCIUTO', () => {
    const r = new RegistroAdattatori([creaAdattatoreFinto()])
    let errore: unknown
    try {
      r.trova('NONESISTE')
    } catch (e) {
      errore = e
    }
    expect(errore).toBeInstanceOf(BadRequestException)
    expect((errore as BadRequestException).getResponse()).toMatchObject({
      error: 'ADATTATORE_SCONOSCIUTO',
    })
  })

  it('il codice non e` sensibile alle chiavi dell`oggetto (nessun prototype lookup)', () => {
    const r = new RegistroAdattatori([creaAdattatoreFinto()])
    for (const codice of ['constructor', '__proto__', 'toString', '']) {
      expect(() => r.trova(codice)).toThrow(BadRequestException)
    }
  })

  it('due adattatori con lo stesso codice: errore alla costruzione', () => {
    expect(
      () =>
        new RegistroAdattatori([
          creaAdattatoreFinto({ codice: 'X' }),
          creaAdattatoreFinto({ codice: 'X' }),
        ])
    ).toThrow(/duplicat/i)
  })

  it('un codice piu` lungo di 30 caratteri non e` ammesso (colonna varchar(30))', () => {
    expect(() => new RegistroAdattatori([creaAdattatoreFinto({ codice: 'X'.repeat(31) })])).toThrow(
      /30/
    )
  })
})
