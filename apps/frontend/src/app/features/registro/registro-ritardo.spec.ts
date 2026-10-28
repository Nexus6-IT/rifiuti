import { giorniDiRitardo } from './registro-ritardo'

describe('giorniDiRitardo', () => {
  it("conta i giorni di calendario, non le 24 ore: l'ora dell'operazione non toglie un giorno", () => {
    // Dalle 18:00 del 1/10 alle 10:00 del 15/10 sono 13 giorni e 16 ore: 14 giorni di calendario.
    const operazione = new Date(2026, 9, 1, 18, 0)
    const adesso = new Date(2026, 9, 15, 10, 0)
    expect(giorniDiRitardo(operazione, adesso)).toBe(14)
  })

  it('il giorno della registrazione è quello italiano (Europe/Rome)', () => {
    // 22:30 UTC del 15/10 = 00:30 del 16/10 in Italia: 15 giorni dal 1/10.
    const operazione = new Date(2026, 9, 1, 12, 0)
    const adesso = new Date('2026-10-15T22:30:00Z')
    expect(giorniDiRitardo(operazione, adesso)).toBe(15)
  })

  it('mai negativo', () => {
    expect(giorniDiRitardo(new Date(2026, 9, 20), new Date(2026, 9, 15, 12, 0))).toBe(0)
  })
})
