import { messaggioMovimentoRegistrato } from './registro-messaggi'

describe('messaggioMovimentoRegistrato', () => {
  it('movimento nuovo', () => {
    expect(messaggioMovimentoRegistrato({ progressiveNumber: 4, progressiveYear: 2026 })).toBe(
      'Movimento 2026/4 registrato'
    )
  })

  it('movimento nuovo fuori termine', () => {
    expect(
      messaggioMovimentoRegistrato({
        progressiveNumber: 4,
        progressiveYear: 2026,
        fuoriTermine: true,
      })
    ).toBe('Movimento 2026/4 registrato — ATTENZIONE: fuori termine di legge')
  })

  it('ricopia già registrata', () => {
    expect(
      messaggioMovimentoRegistrato({
        progressiveNumber: 4,
        progressiveYear: 2026,
        giaRegistrato: true,
      })
    ).toBe('Il FIR era già registrato nel movimento 2026/4: nessun nuovo movimento creato')
  })
})
