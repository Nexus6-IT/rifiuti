import { normalizzaPerimetro } from './aggiorna-prezzi.service'

const C = '11111111-1111-4111-8111-111111111111'
const E = '22222222-2222-4222-8222-222222222222'

function codice(f: () => unknown): { status: number; error: string } {
  try {
    f()
  } catch (e) {
    const r = e as { getResponse(): { error: string }; getStatus(): number }
    return { status: r.getStatus(), error: r.getResponse().error }
  }
  throw new Error('attesa un’eccezione')
}

describe('normalizzaPerimetro', () => {
  it('contratto, elenco e periodo validi; i vuoti diventano null', () => {
    expect(normalizzaPerimetro({ contrattoId: C, dal: '2026-01-01', al: '2026-12-31' })).toEqual({
      contrattoId: C,
      elencoId: null,
      dal: '2026-01-01',
      al: '2026-12-31',
    })
    expect(normalizzaPerimetro({ elencoId: E, contrattoId: '', dal: '' })).toEqual({
      contrattoId: null,
      elencoId: E,
      dal: null,
      al: null,
    })
  })

  it.each([
    ['nessun contratto né elenco', {}],
    ['id non uuid', { contrattoId: 'abc' }],
    ['elenco non uuid', { elencoId: '123' }],
    ['data inesistente', { contrattoId: C, dal: '2026-02-30' }],
    ['data scritta male', { contrattoId: C, al: '01/02/2026' }],
    ['periodo rovesciato', { contrattoId: C, dal: '2026-05-02', al: '2026-05-01' }],
    ['perimetro assente', undefined as never],
  ])('%s: 400 PERIMETRO_NON_VALIDO', (_nome, p) => {
    expect(codice(() => normalizzaPerimetro(p))).toEqual({
      status: 400,
      error: 'PERIMETRO_NON_VALIDO',
    })
  })

  it('stesso giorno come dal e al: valido', () => {
    expect(normalizzaPerimetro({ contrattoId: C, dal: '2026-05-01', al: '2026-05-01' }).dal).toBe(
      '2026-05-01'
    )
  })
})
