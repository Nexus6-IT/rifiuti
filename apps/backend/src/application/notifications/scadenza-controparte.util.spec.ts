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

  it('con oggi e scadenza allo stesso istante, restituisce 0 giorni e non è scaduta', () => {
    // Stessa data/ora esatta: differenza nulla, non ancora scaduta.
    expect(calcolaScadenza(oggi, oggi)).toEqual({
      giorniAllaScadenza: 0,
      scaduta: false,
    })
  })

  /**
   * Correzione di revisione (rilievo minore): il test precedente si chiamava
   * "...solo se già superata nelle ore" ma verificava solo l'istante
   * identico (differenza zero), non un vero confine orario. Questo test
   * copre davvero il caso: una scadenza delle 08:00 con "oggi" alle 14:00
   * dello STESSO giorno solare — l'orario è già passato, ma la differenza
   * (-6 ore) è comunque sotto le 24 ore piene, quindi `Math.ceil` la riporta
   * a 0 (o "-0", numericamente identico a 0 in JS: `-0 === 0`), non a un
   * valore negativo. Non ancora "scaduta" finché non passa l'intero giorno
   * solare: stessa granularità già usata per le date di scadenza (sempre a
   * mezzanotte) confrontate con `new Date()` nei cron del Task 1.
   */
  it('una scadenza già passata nelle ore ma nello stesso giorno solare non è ancora "scaduta" (differenza sotto le 24 ore piene)', () => {
    const oggiPomeriggio = new Date('2026-09-11T14:00:00.000Z')
    const scadenzaStessoGiornoMattina = new Date('2026-09-11T08:00:00.000Z') // -6 ore, stesso giorno
    const esito = calcolaScadenza(scadenzaStessoGiornoMattina, oggiPomeriggio)

    expect(esito.giorniAllaScadenza === 0).toBe(true)
    expect(esito.scaduta).toBe(false)
  })

  describe('giorno di calendario italiano (scadenza @db.Date = mezzanotte UTC)', () => {
    const scadenza = new Date('2026-11-15T00:00:00.000Z')

    it('dopo la mezzanotte di Roma la scadenza del giorno prima è già scaduta (00:30 Roma = 23:30Z)', () => {
      const oggi = new Date('2026-11-15T23:30:00.000Z') // 16/11 00:30 a Roma (UTC+1)
      expect(calcolaScadenza(scadenza, oggi)).toEqual({ giorniAllaScadenza: -1, scaduta: true })
    })

    it('prima della mezzanotte di Roma la scadenza è oggi, non scaduta (23:30 Roma = 22:30Z)', () => {
      const oggi = new Date('2026-11-15T22:30:00.000Z') // 15/11 23:30 a Roma (UTC+1)
      expect(calcolaScadenza(scadenza, oggi)).toEqual({ giorniAllaScadenza: 0, scaduta: false })
    })

    it('in ora legale (UTC+2) il giorno cambia alle 22:00Z', () => {
      const luglio = new Date('2026-07-15T00:00:00.000Z')
      expect(calcolaScadenza(luglio, new Date('2026-07-15T21:30:00.000Z'))).toEqual({
        giorniAllaScadenza: 0,
        scaduta: false,
      }) // 23:30 a Roma
      expect(calcolaScadenza(luglio, new Date('2026-07-15T22:30:00.000Z'))).toEqual({
        giorniAllaScadenza: -1,
        scaduta: true,
      }) // 00:30 del 16 a Roma
    })

    it('al cambio ora di ottobre (25/10/2026, 31 -> 30 ore) conta giorni di calendario', () => {
      const oggi = new Date('2026-10-24T10:00:00.000Z')
      expect(calcolaScadenza(new Date('2026-10-26T00:00:00.000Z'), oggi).giorniAllaScadenza).toBe(2)
      // 26/10 00:30 a Roma = 25/10 23:30Z (ora solare): la scadenza del 25 è passata
      expect(
        calcolaScadenza(new Date('2026-10-25T00:00:00.000Z'), new Date('2026-10-25T23:30:00.000Z'))
      ).toEqual({ giorniAllaScadenza: -1, scaduta: true })
    })

    it('al cambio ora di marzo (29/03/2026, giorno di 23 ore) conta giorni di calendario', () => {
      const oggi = new Date('2026-03-28T12:00:00.000Z')
      expect(calcolaScadenza(new Date('2026-03-30T00:00:00.000Z'), oggi).giorniAllaScadenza).toBe(2)
      // 30/03 00:30 a Roma (ora legale) = 29/03 22:30Z: la scadenza del 29 è passata
      expect(
        calcolaScadenza(new Date('2026-03-29T00:00:00.000Z'), new Date('2026-03-29T22:30:00.000Z'))
      ).toEqual({ giorniAllaScadenza: -1, scaduta: true })
    })
  })
})
