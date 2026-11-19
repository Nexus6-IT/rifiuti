import { scadenzaTrasmissione } from './scadenza-trasmissione-rentri'

const d = (iso: string) => new Date(iso)

describe('scadenzaTrasmissione (E0): fine del mese successivo, calendario di Roma', () => {
  const oggi = d('2026-02-10T10:00:00Z')

  it('nessuna annotazione da trasmettere: nessun termine', () => {
    expect(scadenzaTrasmissione([], oggi)).toBeNull()
  })

  it('annotazione del 31/01: termine 28/02 (anno non bisestile)', () => {
    const s = scadenzaTrasmissione([d('2026-01-31T10:00:00Z')], oggi)
    expect(s).toMatchObject({ mese: '2026-01', entro: '2026-02-28', scaduta: false })
  })

  it('annotazione di gennaio in anno bisestile: termine 29/02', () => {
    const s = scadenzaTrasmissione([d('2028-01-15T10:00:00Z')], d('2028-02-01T10:00:00Z'))
    expect(s?.entro).toBe('2028-02-29')
  })

  it('annotazione del 31/12: termine 31/01 dell’anno dopo', () => {
    const s = scadenzaTrasmissione([d('2026-12-31T10:00:00Z')], d('2027-01-05T10:00:00Z'))
    expect(s).toMatchObject({ mese: '2026-12', entro: '2027-01-31', scaduta: false })
  })

  it('usa la più vecchia delle annotazioni, in qualunque ordine', () => {
    const s = scadenzaTrasmissione(
      [d('2026-03-10T10:00:00Z'), d('2026-01-02T10:00:00Z'), d('2026-02-20T10:00:00Z')],
      oggi
    )
    expect(s?.mese).toBe('2026-01')
    expect(s?.entro).toBe('2026-02-28')
  })

  it('il mese è quello di Roma: le 23:30 UTC del 31/01 sono già 1° febbraio a Roma', () => {
    const s = scadenzaTrasmissione([d('2026-01-31T23:30:00Z')], oggi)
    expect(s).toMatchObject({ mese: '2026-02', entro: '2026-03-31' })
  })

  it('il termine vale fino a tutto l’ultimo giorno (ora di Roma): non scaduta il 28/02 sera', () => {
    const s = scadenzaTrasmissione([d('2026-01-10T10:00:00Z')], d('2026-02-28T22:30:00Z'))
    expect(s?.scaduta).toBe(false)
    expect(s?.giorniRimanenti).toBe(0)
  })

  it('scaduta dal giorno dopo il termine, con giorni negativi', () => {
    const s = scadenzaTrasmissione([d('2026-01-10T10:00:00Z')], d('2026-03-02T10:00:00Z'))
    expect(s).toMatchObject({ scaduta: true, giorniRimanenti: -2 })
  })

  it('giorni rimanenti contati sul calendario di Roma', () => {
    const s = scadenzaTrasmissione([d('2026-01-10T10:00:00Z')], d('2026-02-23T10:00:00Z'))
    expect(s?.giorniRimanenti).toBe(5)
  })

  it('a cavallo dell’ora legale i giorni restano interi', () => {
    // termine 30/04, oggi 25/03 (ora solare) -> 36 giorni
    const s = scadenzaTrasmissione([d('2026-03-12T10:00:00Z')], d('2026-03-25T10:00:00Z'))
    expect(s?.entro).toBe('2026-04-30')
    expect(s?.giorniRimanenti).toBe(36)
  })

  it('date non valide: errore, non un termine inventato', () => {
    expect(() => scadenzaTrasmissione([new Date('x')], oggi)).toThrow()
  })
})
