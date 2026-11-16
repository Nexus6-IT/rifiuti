import { decodificaOper } from './oper'

// docs/movimenti.md §2.4: OPER = TIP + OPE della causale (inferenza media-alta).
describe('decodificaOper', () => {
  it.each([
    ['10', 'CARICO', 'T', false],
    ['11', 'SCARICO', 'T', true],
    ['12', 'NESSUNA_GIACENZA', null, false],
    ['13', 'ENTRAMBI', 'T', true],
    ['14', 'CARICO', 'R_D', false],
    ['15', 'ENTRAMBI', 'T', true],
    ['16', 'CARICO', null, false],
    ['20', 'CARICO', 'R_D', false],
    ['21', 'SCARICO', 'R_D', true],
    ['22', 'CARICO', 'R_D', false],
    ['23', 'SCARICO', 'R_D', true],
    ['24', 'ENTRAMBI', 'R_D', true],
    ['25', 'CARICO', 'R_D', false],
    ['26', 'CARICO', null, false],
    ['28', 'NESSUNA_GIACENZA', null, false],
    ['30', 'NESSUNA_GIACENZA', null, false],
    ['40', 'NESSUNA_GIACENZA', null, false],
    ['50', 'CARICO', 'X', false],
  ])('%s -> %s classe %s relazione %s', (codice, tipo, classe, richiedeRelazione) => {
    expect(decodificaOper(codice)).toEqual({
      ok: true,
      valore: { codice, tipo, classe, richiedeRelazione, dedotta: false },
    })
  })

  it('obbligo di relazione solo per 11 13 15 21 23 24 51', () => {
    const con = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
      .map(c => decodificaOper(c))
      .filter(r => r.ok && r.valore.richiedeRelazione)
      .map(r => (r.ok ? r.valore.codice : ''))
    expect(con).toEqual(['11', '13', '15', '21', '23', '24', '51'])
  })

  it.each([['27'], ['51'], ['52']])('%s e una corrispondenza dedotta', codice => {
    expect(decodificaOper(codice)).toMatchObject({ ok: true, valore: { dedotta: true } })
  })

  it.each([['60'], ['70'], ['99']])('%s: solo fatturazione', codice => {
    expect(decodificaOper(codice)).toEqual({
      ok: true,
      valore: {
        codice,
        tipo: 'SOLO_FATTURAZIONE',
        classe: null,
        richiedeRelazione: false,
        dedotta: false,
      },
    })
  })

  it.each([['19'], ['00'], ['17'], ['29'], ['31'], ['5'], [''], [null], ['AB'], ['123']])(
    '%p: sconosciuto',
    v => {
      expect(decodificaOper(v)).toMatchObject({ ok: false, codice: 'OPER_SCONOSCIUTO' })
    }
  )
})
