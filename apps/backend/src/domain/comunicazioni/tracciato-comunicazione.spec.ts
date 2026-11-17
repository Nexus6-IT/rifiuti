import { registroTracciati } from './registro-tracciati'
import { TracciatoOrsoImpiantoMesi } from './orso/serializza-impianto-mesi'

describe('contratto TracciatoComunicazione (D7)', () => {
  it('O.R.SO. normale: utf-8, ufficiale, con una nota', () => {
    const t = registroTracciati.get('ORSO', 'ImpiantoMesi-1')
    expect(t).toBe(TracciatoOrsoImpiantoMesi)
    expect(t.codifica).toBe('utf-8')
    expect(t.affidabilita).toBe('UFFICIALE')
    expect(t.notaAffidabilita.length).toBeGreaterThan(0)
  })
})
