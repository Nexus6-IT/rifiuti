import { CaricamentoBloccoFallitoError, LottoGiaInCorsoError, causaSenzaDati } from './errori'

describe('causaSenzaDati (Fase 3, Task 9)', () => {
  const raw = (code: string, message: string) => ({ code: 'P2010', meta: { code, message } })

  it('unicità: solo classe e codice, mai il messaggio (che porterebbe i valori)', () => {
    const c = causaSenzaDati(raw('23505', 'Key (partita_iva)=(00012345675) already exists'))
    expect(c).toBe('violazione di unicità (codice 23505)')
    expect(c).not.toContain('00012345675')
  })

  it('RLS, chiave esterna e codici sconosciuti', () => {
    expect(causaSenzaDati(raw('42501', 'x'))).toContain('RLS')
    expect(causaSenzaDati(raw('23503', 'x'))).toContain('chiave esterna')
    expect(causaSenzaDati(raw('XX000', 'x'))).toBe('errore del database (codice XX000)')
    expect(causaSenzaDati(new Error('boh'))).toBe('errore del database')
  })

  it('23514 (i trigger della Fase 3): il testo della regola, senza prefisso ERROR e al massimo 300 caratteri', () => {
    const c = causaSenzaDati(raw('23514', 'ERROR: regola di prova ' + 'x'.repeat(500)))
    expect(c).toContain('regola di prova')
    expect(c).not.toContain('ERROR:')
    expect(c.length).toBeLessThan(400)
  })

  it('codice presente solo sul livello alto', () => {
    expect(causaSenzaDati({ code: '23505' })).toContain('23505')
  })
})

describe('errori del caricamento', () => {
  it('LottoGiaInCorsoError e CaricamentoBloccoFallitoError', () => {
    expect(new LottoGiaInCorsoError('WW00012026', 'FIR').message).toContain('WW00012026')
    const e = new CaricamentoBloccoFallitoError('l1', 2, 'violazione')
    expect(e.numeroBlocco).toBe(2)
    expect(e.message).toBe('Caricamento fermo al blocco 2: violazione')
  })
})
