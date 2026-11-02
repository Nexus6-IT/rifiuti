import { leggiErroriAzione } from './errori-azione'

describe('leggiErroriAzione', () => {
  it('error.errori con campo e messaggio', () => {
    const r = leggiErroriAzione(
      { status: 400, error: { errori: [{ campo: 'prezzo', messaggio: 'Prezzo errato.' }] } },
      'x'
    )
    expect(r).toEqual({ messaggi: ['Prezzo errato.'], conflitto: false })
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
    expect(leggiErroriAzione({ status: 409 }, 'Ripiego.')).toEqual({
      messaggi: ['Ripiego.'],
      conflitto: true,
    })
    expect(leggiErroriAzione(null, 'Ripiego.').conflitto).toBe(false)
  })
})
