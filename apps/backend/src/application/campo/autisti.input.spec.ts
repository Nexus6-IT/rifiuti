import { normalizzaDatiAutista } from './autisti.input'
import { ordinaGiro } from './giro.service'
import type { RitiroVista } from '../ritiri/ritiri.tipi'

const U = '00000000-0000-4000-8000-000000000001'

describe('normalizzaDatiAutista', () => {
  it('toglie gli spazi, mette in maiuscolo codice fiscale e categoria, vuoto diventa null', () => {
    const e = normalizzaDatiAutista({
      nome: ' Luca ',
      cognome: 'Bianchi ',
      codiceFiscale: ' bnclcu80a01h501z ',
      patenteCategoria: 'ce',
      patenteNumero: '  ',
      telefono: '',
      trasportatoreId: null,
    })
    expect(e).toMatchObject({
      ok: true,
      valori: {
        nome: 'Luca',
        cognome: 'Bianchi',
        codiceFiscale: 'BNCLCU80A01H501Z',
        patenteCategoria: 'CE',
        patenteNumero: null,
        telefono: null,
        trasportatoreId: null,
        userId: null,
      },
    })
  })

  it('le date diventano mezzanotte UTC; una data impossibile e un errore', () => {
    const ok = normalizzaDatiAutista({
      nome: 'A',
      cognome: 'B',
      patenteScadenza: '2030-05-31',
    })
    expect(ok.ok && ok.valori.patenteScadenza?.toISOString()).toBe('2030-05-31T00:00:00.000Z')
    const ko = normalizzaDatiAutista({
      nome: 'A',
      cognome: 'B',
      cqcScadenza: '2030-13-01',
      adrScadenza: '31/12/2030',
    })
    expect(ko).toEqual({
      ok: false,
      messaggi: [
        'La scadenza della CQC non è una data valida.',
        'La scadenza dell’ADR non è una data valida.',
      ],
    })
  })

  it.each([
    [{ nome: '', cognome: 'B' }, 'Il nome è obbligatorio.'],
    [{ nome: 'A', cognome: ' ' }, 'Il cognome è obbligatorio.'],
    [{ nome: 'x'.repeat(101), cognome: 'B' }, 'Il nome può avere al massimo 100 caratteri.'],
    [
      { nome: 'A', cognome: 'B', codiceFiscale: 'ABC' },
      'Il codice fiscale deve avere 16 caratteri.',
    ],
    [
      { nome: 'A', cognome: 'B', codiceFiscale: 'ABCDEFGHIJKLMNO!' },
      'Il codice fiscale deve avere 16 caratteri.',
    ],
    [{ nome: 'A', cognome: 'B', userId: 'x' }, 'L’utente indicato non è valido.'],
    [{ nome: 'A', cognome: 'B', trasportatoreId: 'x' }, 'Il trasportatore indicato non è valido.'],
  ])('rifiuta %j', (dati, messaggio) => {
    const e = normalizzaDatiAutista(dati)
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.messaggi).toContain(messaggio)
  })

  it('accetta riferimenti uuid validi', () => {
    expect(
      normalizzaDatiAutista({ nome: 'A', cognome: 'B', userId: U, trasportatoreId: U }).ok
    ).toBe(true)
  })
})

describe('ordinaGiro', () => {
  const r = (id: string, ordineGiro: number | null) => ({ id, ordineGiro }) as RitiroVista
  it('ordine crescente, senza ordine in fondo, stabile fra pari', () => {
    expect(
      ordinaGiro([r('a', null), r('b', 3), r('c', 1), r('d', null), r('e', 2)]).map(x => x.id)
    ).toEqual(['c', 'e', 'b', 'a', 'd'])
  })
  it('non modifica l elenco ricevuto', () => {
    const input = [r('a', 2), r('b', 1)]
    ordinaGiro(input)
    expect(input.map(x => x.id)).toEqual(['a', 'b'])
  })
})
