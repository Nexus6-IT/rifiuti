import { espandiRipetizione } from './ripetizione'

describe('espandiRipetizione', () => {
  it('ogni 7 giorni fino al: include data di partenza e il giorno finale', () => {
    const r = espandiRipetizione('2026-11-02', { ogniGiorni: 7, fino: '2026-11-30' })
    expect(r).toEqual({
      ok: true,
      date: ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'],
    })
  })

  it('ogni N settimane equivale a 7N giorni', () => {
    const r = espandiRipetizione('2026-11-02', { ogniSettimane: 2, fino: '2026-12-14' })
    expect(r).toEqual({ ok: true, date: ['2026-11-02', '2026-11-16', '2026-11-30', '2026-12-14'] })
  })

  it('fino alla data di partenza dà una sola occorrenza', () => {
    expect(espandiRipetizione('2026-11-02', { ogniGiorni: 1, fino: '2026-11-02' })).toEqual({
      ok: true,
      date: ['2026-11-02'],
    })
  })

  it('il limite di 52 occorrenze è incluso, la 53ª è errore (nessun troncamento)', () => {
    const ok = espandiRipetizione('2026-01-05', { ogniSettimane: 1, fino: '2026-12-28' })
    expect(ok.ok && ok.date).toHaveLength(52)
    const ko = espandiRipetizione('2026-01-05', { ogniSettimane: 1, fino: '2027-01-04' })
    expect(ko).toEqual({ ok: false, codice: 'TROPPE_OCCORRENZE' })
    expect(espandiRipetizione('2026-01-05', { ogniGiorni: 1, fino: '2026-03-31' })).toEqual({
      ok: false,
      codice: 'TROPPE_OCCORRENZE',
    })
  })

  it('una scadenza oltre un anno dalla partenza è errore, anche con pochissime occorrenze', () => {
    expect(espandiRipetizione('2026-11-02', { ogniSettimane: 40, fino: '2027-11-03' })).toEqual({
      ok: false,
      codice: 'FINO_OLTRE_UN_ANNO',
    })
    const ok = espandiRipetizione('2026-11-02', { ogniSettimane: 40, fino: '2027-11-02' })
    expect(ok).toEqual({ ok: true, date: ['2026-11-02', '2027-08-09'] })
  })

  it("il 29 febbraio ha scadenza massima il 28 febbraio dell'anno dopo", () => {
    expect(espandiRipetizione('2028-02-29', { ogniGiorni: 400, fino: '2029-02-28' }).ok).toBe(true)
    expect(espandiRipetizione('2028-02-29', { ogniGiorni: 400, fino: '2029-03-01' })).toEqual({
      ok: false,
      codice: 'FINO_OLTRE_UN_ANNO',
    })
  })

  it("i cambi dell'ora legale non spostano i giorni (ora italiana)", () => {
    // 25/10/2026 fine ora legale, 29/03/2026 inizio
    const autunno = espandiRipetizione('2026-10-24', { ogniGiorni: 1, fino: '2026-10-27' })
    expect(autunno).toEqual({
      ok: true,
      date: ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'],
    })
    const primavera = espandiRipetizione('2026-03-27', { ogniGiorni: 1, fino: '2026-03-30' })
    expect(primavera).toEqual({
      ok: true,
      date: ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30'],
    })
  })

  it("attraversa il cambio d'anno", () => {
    expect(espandiRipetizione('2026-12-28', { ogniGiorni: 2, fino: '2027-01-03' })).toEqual({
      ok: true,
      date: ['2026-12-28', '2026-12-30', '2027-01-01', '2027-01-03'],
    })
  })

  it('rifiuta fino prima della partenza, passo non valido, date non valide', () => {
    expect(espandiRipetizione('2026-11-02', { ogniGiorni: 1, fino: '2026-11-01' })).toEqual({
      ok: false,
      codice: 'FINO_PRIMA_DELLA_DATA',
    })
    for (const rip of [
      { ogniGiorni: 0, fino: '2026-11-10' },
      { ogniGiorni: 1.5, fino: '2026-11-10' },
      { ogniGiorni: 1, ogniSettimane: 1, fino: '2026-11-10' },
      { fino: '2026-11-10' },
    ]) {
      expect(espandiRipetizione('2026-11-02', rip)).toEqual({
        ok: false,
        codice: 'PASSO_NON_VALIDO',
      })
    }
    expect(espandiRipetizione('2026-02-30', { ogniGiorni: 1, fino: '2026-03-10' })).toEqual({
      ok: false,
      codice: 'DATA_NON_VALIDA',
    })
  })
})
