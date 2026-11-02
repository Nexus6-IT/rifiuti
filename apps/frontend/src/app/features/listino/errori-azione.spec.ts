import { eConcorrente, leggiErroriAzione } from './errori-azione'

describe('leggiErroriAzione', () => {
  it('error.errori con campo e messaggio', () => {
    const r = leggiErroriAzione(
      { status: 400, error: { errori: [{ campo: 'prezzo', messaggio: 'Prezzo errato.' }] } },
      'x'
    )
    expect(r.messaggi).toEqual(['Prezzo errato.'])
    expect(r.campi).toEqual([{ campo: 'prezzo', messaggio: 'Prezzo errato.' }])
    expect(r.conflitto).toBeFalse()
  })

  it('error.details.errori (filtro globale, R60), anche stringhe', () => {
    const r = leggiErroriAzione(
      { status: 400, error: { details: { errori: ['Uno.', { messaggio: 'Due.' }] } } },
      'x'
    )
    expect(r.messaggi).toEqual(['Uno.', 'Due.'])
  })

  it('message come array o stringa', () => {
    expect(
      leggiErroriAzione({ status: 400, error: { message: ['A.', 'B.'] } }, 'x').messaggi
    ).toEqual(['A.', 'B.'])
    expect(leggiErroriAzione({ status: 400, error: { message: 'C.' } }, 'x').messaggi).toEqual([
      'C.',
    ])
  })

  it('409 è un conflitto; senza messaggio vale il ripiego', () => {
    const r = leggiErroriAzione({ status: 409 }, 'Ripiego.')
    expect(r.messaggi).toEqual(['Ripiego.'])
    expect(r.conflitto).toBeTrue()
    expect(r.codice).toBeNull()
    expect(leggiErroriAzione(null, 'Ripiego.').conflitto).toBe(false)
  })

  it('due 409 distinti: il codice sta in error.error', () => {
    const superata = leggiErroriAzione(
      { status: 409, error: { error: 'VARIAZIONE_SUPERATA' } },
      'x'
    )
    const concorrente = leggiErroriAzione(
      { status: 409, error: { error: 'OPERAZIONE_CONCORRENTE' } },
      'x'
    )
    expect(superata.codice).toBe('VARIAZIONE_SUPERATA')
    expect(eConcorrente(superata)).toBeFalse()
    expect(eConcorrente(concorrente)).toBeTrue()
  })
})
