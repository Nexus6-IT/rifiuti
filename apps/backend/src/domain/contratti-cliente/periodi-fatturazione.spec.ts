import {
  ordinaPeriodi,
  periodiDaFrequenza,
  periodoDaFatturare,
  prossimaFinePeriodo,
  validaPeriodi,
  type PeriodoFatturazione,
} from './periodi-fatturazione'

const p = (
  giornoInizio: number,
  meseInizio: number,
  giornoFine: number,
  meseFine: number
): PeriodoFatturazione => ({ giornoInizio, meseInizio, giornoFine, meseFine })

describe('periodiDaFrequenza', () => {
  it('MENSILE: 12 periodi, febbraio finisce il 28', () => {
    const r = periodiDaFrequenza('MENSILE')
    expect(r).toHaveLength(12)
    expect(r[0]).toEqual(p(1, 1, 31, 1))
    expect(r[1]).toEqual(p(1, 2, 28, 2))
    expect(r[3]).toEqual(p(1, 4, 30, 4))
    expect(r[11]).toEqual(p(1, 12, 31, 12))
  })
  it('TRIMESTRALE: i quattro di D10', () => {
    expect(periodiDaFrequenza('TRIMESTRALE')).toEqual([
      p(1, 1, 31, 3),
      p(1, 4, 30, 6),
      p(1, 7, 30, 9),
      p(1, 10, 31, 12),
    ])
  })
  it('ANNUALE: 01/01-31/12', () => {
    expect(periodiDaFrequenza('ANNUALE')).toEqual([p(1, 1, 31, 12)])
  })
  it('BIMESTRALE, QUADRIMESTRALE, SEMESTRALE', () => {
    expect(periodiDaFrequenza('BIMESTRALE')).toEqual([
      p(1, 1, 28, 2),
      p(1, 3, 30, 4),
      p(1, 5, 30, 6),
      p(1, 7, 31, 8),
      p(1, 9, 31, 10),
      p(1, 11, 31, 12),
    ])
    expect(periodiDaFrequenza('QUADRIMESTRALE')).toEqual([
      p(1, 1, 30, 4),
      p(1, 5, 31, 8),
      p(1, 9, 31, 12),
    ])
    expect(periodiDaFrequenza('SEMESTRALE')).toEqual([p(1, 1, 30, 6), p(1, 7, 31, 12)])
  })
  it('tutte le frequenze producono periodi validi', () => {
    for (const f of [
      'MENSILE',
      'BIMESTRALE',
      'TRIMESTRALE',
      'QUADRIMESTRALE',
      'SEMESTRALE',
      'ANNUALE',
    ] as const) {
      expect(validaPeriodi(periodiDaFrequenza(f))).toEqual([])
    }
  })
})

describe('validaPeriodi', () => {
  it('elenco vuoto valido', () => expect(validaPeriodi([])).toEqual([]))
  it('13 periodi', () => {
    const tredici = Array.from({ length: 13 }, () => p(1, 1, 2, 1))
    expect(validaPeriodi(tredici)).toContain('Al massimo 12 periodi di fatturazione.')
  })
  it('31/04 non valido, 29/02 valido', () => {
    expect(validaPeriodi([p(1, 4, 31, 4)])).toEqual(['Periodo 1: data non valida.'])
    expect(validaPeriodi([p(1, 2, 29, 2)])).toEqual([])
    expect(validaPeriodi([p(1, 13, 5, 13)])).toEqual(['Periodo 1: data non valida.'])
  })
  it("inizio 01/12 e fine 31/01: non attraversano l'anno", () => {
    expect(validaPeriodi([p(1, 12, 31, 1)])).toEqual([
      "Periodo 1: l'inizio non può seguire la fine (i periodi non attraversano l'anno).",
    ])
  })
  it('sovrapposti', () => {
    expect(validaPeriodi([p(1, 1, 31, 3), p(1, 3, 30, 6)])).toEqual([
      'I periodi 1 e 2 si sovrappongono.',
    ])
  })
  it('adiacenti validi', () => {
    expect(validaPeriodi([p(1, 1, 31, 3), p(1, 4, 30, 6)])).toEqual([])
  })
  it('disordinati validi, ordinaPeriodi li ordina', () => {
    const disordinati = [p(1, 4, 30, 6), p(1, 1, 31, 3)]
    expect(validaPeriodi(disordinati)).toEqual([])
    expect(ordinaPeriodi(disordinati)).toEqual([p(1, 1, 31, 3), p(1, 4, 30, 6)])
    expect(disordinati[0]).toEqual(p(1, 4, 30, 6))
  })
})

describe('periodoDaFatturare (E7)', () => {
  const trimestrale = periodiDaFrequenza('TRIMESTRALE')

  it('nessun periodo -> NESSUN_PERIODO', () => {
    expect(periodoDaFatturare([], '2026-03-01', '2026-03-31')).toEqual({ esito: 'NESSUN_PERIODO' })
  })
  it('trimestrale, marzo -> il primo trimestre', () => {
    expect(periodoDaFatturare(trimestrale, '2026-03-01', '2026-03-31')).toEqual({
      esito: 'PERIODO',
      dal: '2026-01-01',
      al: '2026-03-31',
    })
  })
  it('trimestrale, febbraio -> NESSUNA_SCADENZA', () => {
    expect(periodoDaFatturare(trimestrale, '2026-02-01', '2026-02-28')).toEqual({
      esito: 'NESSUNA_SCADENZA',
    })
  })
  it("intervallo a cavallo d'anno -> ERRORE", () => {
    expect(periodoDaFatturare(trimestrale, '2026-12-15', '2027-01-15')).toEqual({
      esito: 'ERRORE',
      messaggio: "L'intervallo di fatturazione non può attraversare l'anno.",
    })
  })
  it('mensile su tre mesi -> ERRORE più periodi', () => {
    expect(periodoDaFatturare(periodiDaFrequenza('MENSILE'), '2026-01-01', '2026-03-31')).toEqual({
      esito: 'ERRORE',
      messaggio: "Nell'intervallo terminano più periodi del contratto: restringi le date.",
    })
  })
  it('fine 28/02 diventa 29/02 negli anni bisestili', () => {
    const mensile = periodiDaFrequenza('MENSILE')
    expect(periodoDaFatturare(mensile, '2028-02-01', '2028-02-29')).toEqual({
      esito: 'PERIODO',
      dal: '2028-02-01',
      al: '2028-02-29',
    })
    expect(periodoDaFatturare(mensile, '2026-02-01', '2026-02-28')).toEqual({
      esito: 'PERIODO',
      dal: '2026-02-01',
      al: '2026-02-28',
    })
  })
  it('intervallo con la data finale prima di quella iniziale -> ERRORE', () => {
    expect(periodoDaFatturare(trimestrale, '2026-03-31', '2026-03-01').esito).toBe('ERRORE')
  })
})

describe('prossimaFinePeriodo', () => {
  const trimestrale = periodiDaFrequenza('TRIMESTRALE')
  it('oggi 2026-05-10 -> 2026-06-30', () => {
    expect(prossimaFinePeriodo(trimestrale, '2026-05-10')).toBe('2026-06-30')
  })
  it('oggi 2026-12-31 -> 2026-12-31', () => {
    expect(prossimaFinePeriodo(trimestrale, '2026-12-31')).toBe('2026-12-31')
  })
  it("dopo l'ultima fine -> la prima dell'anno dopo", () => {
    expect(prossimaFinePeriodo([p(1, 1, 31, 3)], '2026-05-10')).toBe('2027-03-31')
  })
  it('nessun periodo -> null', () => {
    expect(prossimaFinePeriodo([], '2026-05-10')).toBeNull()
  })
  it("fine 28/02 nell'anno bisestile successivo -> 29/02", () => {
    expect(prossimaFinePeriodo([p(1, 2, 28, 2)], '2027-06-01')).toBe('2028-02-29')
  })
})
