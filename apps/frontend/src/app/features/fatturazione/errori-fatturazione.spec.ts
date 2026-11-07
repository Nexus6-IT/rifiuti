import { messaggiErroreFatturazione } from './errori-fatturazione'

const errore = (status: number, body: unknown) => ({ status, error: body })

describe('messaggiErroreFatturazione', () => {
  it('un codice di dominio usa l’etichetta del vocabolario, non il testo del server', () => {
    const m = messaggiErroreFatturazione(
      errore(409, { error: 'ELABORAZIONE_IN_CORSO', message: 'id 123 in corso' }),
      'ripiego'
    )
    expect(m).toEqual(["Un'elaborazione è già in corso: attendi che finisca."])
  })

  it('un codice sconosciuto ripiega su error.message stringa', () => {
    expect(
      messaggiErroreFatturazione(errore(400, { error: 'XYZ', message: 'Dati non validi' }), 'r')
    ).toEqual(['Dati non validi'])
  })

  it('error.message come array: tutti i messaggi', () => {
    expect(messaggiErroreFatturazione(errore(400, { message: ['primo', 'secondo'] }), 'r')).toEqual(
      ['primo', 'secondo']
    )
  })

  it('senza corpo usa il ripiego', () => {
    expect(messaggiErroreFatturazione(errore(500, null), 'Non riuscito')).toEqual(['Non riuscito'])
  })
})
