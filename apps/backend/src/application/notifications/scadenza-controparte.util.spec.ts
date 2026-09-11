import { calcolaScadenza } from './scadenza-controparte.util'

describe('calcolaScadenza', () => {
  const oggi = new Date('2026-09-11T00:00:00.000Z')

  it('ritorna giorniAllaScadenza null e scaduta false quando la scadenza non è impostata', () => {
    expect(calcolaScadenza(undefined, oggi)).toEqual({
      giorniAllaScadenza: null,
      scaduta: false,
    })
    expect(calcolaScadenza(null, oggi)).toEqual({
      giorniAllaScadenza: null,
      scaduta: false,
    })
  })

  it('calcola i giorni residui per una scadenza futura, non scaduta', () => {
    const scadenza = new Date('2026-09-21T00:00:00.000Z') // +10 giorni
    expect(calcolaScadenza(scadenza, oggi)).toEqual({
      giorniAllaScadenza: 10,
      scaduta: false,
    })
  })

  it('segnala scaduta con giorni negativi per una data nel passato', () => {
    const scadenza = new Date('2026-09-01T00:00:00.000Z') // -10 giorni
    const esito = calcolaScadenza(scadenza, oggi)
    expect(esito.scaduta).toBe(true)
    expect(esito.giorniAllaScadenza).toBe(-10)
  })

  it('considera scaduta anche la scadenza di oggi stesso solo se già superata nelle ore', () => {
    // Stessa data/ora: 0 giorni, non ancora scaduta.
    expect(calcolaScadenza(oggi, oggi)).toEqual({
      giorniAllaScadenza: 0,
      scaduta: false,
    })
  })
})
