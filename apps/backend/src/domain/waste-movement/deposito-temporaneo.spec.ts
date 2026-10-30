import {
  FRASE_CRITERIO_NON_SCELTO,
  SOGLIE_PREDEFINITE,
  aggiungiGiorni,
  giorniTra,
  scadenzaTemporale,
  treMesiDopo,
  unAnnoDopo,
  validaSoglie,
  valutaDeposito,
  type InputValutazione,
  type SoglieDeposito,
} from './deposito-temporaneo'

const temporale = (o: Partial<SoglieDeposito> = {}): SoglieDeposito => ({
  ...SOGLIE_PREDEFINITE,
  criterio: 'TEMPORALE',
  ...o,
})
const quantitativo = (o: Partial<SoglieDeposito> = {}): SoglieDeposito => ({
  ...SOGLIE_PREDEFINITE,
  criterio: 'QUANTITATIVO',
  ...o,
})

const cer = (
  giornoPiuVecchio: string | null,
  o: Partial<InputValutazione['cer'][number]> = {}
): InputValutazione['cer'][number] => ({
  cerCode: '15 01 01',
  pericoloso: false,
  residuoKg: 100,
  giornoPiuVecchio,
  ...o,
})

describe('date di calendario', () => {
  it("giorniTra attraverso il cambio d'ora e fra anni", () => {
    expect(giorniTra('2026-03-01', '2026-03-31')).toBe(30)
    expect(giorniTra('2026-10-20', '2026-10-30')).toBe(10)
    expect(giorniTra('2025-12-31', '2026-01-01')).toBe(1)
    expect(giorniTra('2025-01-01', '2026-01-01')).toBe(365)
  })

  it('aggiungiGiorni con numeri negativi', () => {
    expect(aggiungiGiorni('2026-05-01', -15)).toBe('2026-04-16')
    expect(aggiungiGiorni('2026-03-01', -1)).toBe('2026-02-28')
    expect(aggiungiGiorni('2026-12-30', 3)).toBe('2027-01-02')
  })

  it.each([
    ['2026-02-01', '2026-05-01'],
    ['2026-05-31', '2026-08-31'],
    ['2026-08-31', '2026-11-30'],
    ['2026-11-30', '2027-02-28'],
    ['2027-11-30', '2028-02-29'],
    ['2026-12-31', '2027-03-31'],
  ])('treMesiDopo(%s) = %s', (da, a) => {
    expect(treMesiDopo(da)).toBe(a)
  })

  it('unAnnoDopo', () => {
    expect(unAnnoDopo('2028-02-29')).toBe('2029-02-28')
    expect(unAnnoDopo('2026-03-31')).toBe('2027-03-31')
  })

  it('scadenzaTemporale: vince il minimo', () => {
    expect(scadenzaTemporale('2026-02-01', null)).toBe('2026-05-01')
    expect(scadenzaTemporale('2026-02-01', 60)).toBe('2026-04-02')
    // trimestre di 89 giorni: 92 non lo allunga
    expect(giorniTra('2026-02-01', '2026-05-01')).toBe(89)
    expect(scadenzaTemporale('2026-02-01', 92)).toBe('2026-05-01')
  })
})

describe('validaSoglie', () => {
  it('le predefinite sono valide', () => {
    expect(validaSoglie(SOGLIE_PREDEFINITE)).toEqual([])
  })

  it.each([0, 1.5])('giorniMax %s non valido', g => {
    expect(validaSoglie({ ...SOGLIE_PREDEFINITE, giorniMax: g })).toHaveLength(1)
  })

  it('giorniMax 93 cita "al massimo 92"', () => {
    const e = validaSoglie({ ...SOGLIE_PREDEFINITE, giorniMax: 93 })
    expect(e).toHaveLength(1)
    expect(e[0]).toContain('al massimo 92')
  })

  it('pericolosi > totale', () => {
    expect(validaSoglie({ ...SOGLIE_PREDEFINITE, kgMaxPericolosi: 30001 })).toHaveLength(1)
  })

  it('preavviso 89 e preavviso = giorniMax', () => {
    expect(validaSoglie({ ...SOGLIE_PREDEFINITE, preavvisoGiorni: 89 })).toHaveLength(1)
    expect(
      validaSoglie({ ...SOGLIE_PREDEFINITE, giorniMax: 30, preavvisoGiorni: 30 })
    ).toHaveLength(1)
    expect(validaSoglie({ ...SOGLIE_PREDEFINITE, giorniMax: 30, preavvisoGiorni: 29 })).toEqual([])
  })

  it('percentuale 100 e kg con 3 decimali', () => {
    expect(validaSoglie({ ...SOGLIE_PREDEFINITE, preavvisoPercentuale: 100 })).toHaveLength(1)
    expect(validaSoglie({ ...SOGLIE_PREDEFINITE, kgMaxTotale: 30000.125 })).toHaveLength(1)
    expect(validaSoglie({ ...SOGLIE_PREDEFINITE, kgMaxTotale: 30000.12 })).toEqual([])
  })
})

describe('valutaDeposito: DURATA', () => {
  const run = (giorno: string, oggi: string, s: SoglieDeposito = temporale()) =>
    valutaDeposito({ cer: [cer(giorno)] }, s, oggi)

  it('lotto del 01/02/2026, oggi 02/05/2026: SUPERATO anche con giorniMax 90', () => {
    const a = run('2026-02-01', '2026-05-02', temporale({ giorniMax: 90 }))
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ tipo: 'DURATA', livello: 'SUPERATO', scadenza: '2026-05-01' })
  })

  it('oggi 01/05 solo PREAVVISO', () => {
    const a = run('2026-02-01', '2026-05-01')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ livello: 'PREAVVISO', valore: 89, soglia: 89, unita: 'giorni' })
  })

  it('preavviso 15: 15/04 nulla, 16/04 PREAVVISO', () => {
    expect(run('2026-02-01', '2026-04-15')).toEqual([])
    expect(run('2026-02-01', '2026-04-16')[0].livello).toBe('PREAVVISO')
  })

  it('preavviso 0 = mai preavviso', () => {
    expect(run('2026-02-01', '2026-05-01', temporale({ preavvisoGiorni: 0 }))).toEqual([])
  })

  it('con giorniMax 30 il preavviso si conta dalla scadenza dei 30 giorni', () => {
    const s = temporale({ giorniMax: 30 }) // scadenza 03/03
    expect(run('2026-02-01', '2026-02-15', s)).toEqual([])
    expect(run('2026-02-01', '2026-02-16', s)[0].livello).toBe('PREAVVISO')
    expect(run('2026-02-01', '2026-03-04', s)[0]).toMatchObject({ livello: 'SUPERATO', soglia: 30 })
    expect(run('2026-02-01', '2026-03-04', s)[0].messaggio).toContain(
      "soglia dell'azienda di 30 giorni"
    )
  })

  it('fine mese: lotto del 30/11/2027', () => {
    const s = temporale({ preavvisoGiorni: 0 })
    expect(run('2027-11-30', '2028-02-29', s)).toEqual([])
    expect(run('2027-11-30', '2028-03-01', s)[0].livello).toBe('SUPERATO')
  })

  it('I3: CER con soli m3 residui (residuoKg 0) da 100 giorni -> SUPERATO', () => {
    const oggi = '2026-10-28'
    const giorno = aggiungiGiorni(oggi, -100)
    const a = valutaDeposito({ cer: [cer(giorno, { residuoKg: 0 })] }, temporale(), oggi)
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ tipo: 'DURATA', livello: 'SUPERATO', valore: 100 })
  })

  it('giornoPiuVecchio null: nessun avviso di durata', () => {
    expect(valutaDeposito({ cer: [cer(null)] }, SOGLIE_PREDEFINITE, '2026-10-28')).toEqual([])
  })

  it('messaggio: date dd/MM/yyyy e scadenza', () => {
    const a = run('2026-07-03', '2026-10-09')
    expect(a[0].messaggio).toBe(
      'CER 15 01 01: il rifiuto più vecchio è in deposito dal 03/07/2026 (98 giorni); andava avviato entro il 03/10/2026 (tre mesi).'
    )
  })
})

describe('valutaDeposito: quantità', () => {
  const tre = (kg: number, pericoloso = false): InputValutazione => ({
    cer: ['A', 'B', 'C'].map(c => cer(null, { cerCode: c, residuoKg: kg, pericoloso })),
  })

  it('somma dei CER: 3 x 12.000 > 30.000 mentre nessuno da solo supera', () => {
    const a = valutaDeposito(tre(12000), quantitativo(), '2026-10-28')
    const tot = a.find(x => x.tipo === 'QUANTITA_TOTALE')
    expect(tot).toMatchObject({
      livello: 'SUPERATO',
      valore: 36000,
      soglia: 30000,
      unita: 'kg',
      cerCode: null,
    })
    expect(a.find(x => x.tipo === 'QUANTITA_PERICOLOSI')).toBeUndefined()
  })

  it('esattamente 30.000 kg -> SUPERATO (raggiunga)', () => {
    const a = valutaDeposito(
      { cer: [cer(null, { residuoKg: 30000 })] },
      quantitativo(),
      '2026-10-28'
    )
    expect(a[0]).toMatchObject({ tipo: 'QUANTITA_TOTALE', livello: 'SUPERATO' })
  })

  it('PREAVVISO a 24.000 (80%), nulla sotto', () => {
    const a = valutaDeposito(
      { cer: [cer(null, { residuoKg: 24000 })] },
      quantitativo(),
      '2026-10-28'
    )
    expect(a[0]).toMatchObject({ tipo: 'QUANTITA_TOTALE', livello: 'PREAVVISO' })
    expect(
      valutaDeposito({ cer: [cer(null, { residuoKg: 23999 })] }, quantitativo(), '2026-10-28')
    ).toEqual([])
  })

  it('QUANTITA_PERICOLOSI solo coi CER pericolosi', () => {
    const input: InputValutazione = {
      cer: [
        cer(null, { cerCode: '13 02 05*', pericoloso: true, residuoKg: 6000 }),
        cer(null, { cerCode: '15 01 01', residuoKg: 8000 }),
        cer(null, { cerCode: '15 01 02', residuoKg: 4000, pericoloso: true }),
      ],
    }
    const a = valutaDeposito(input, quantitativo(), '2026-10-28')
    expect(a.find(x => x.tipo === 'QUANTITA_PERICOLOSI')).toMatchObject({
      livello: 'SUPERATO',
      valore: 10000,
    })
  })

  it('percentuale 0 = nessun preavviso', () => {
    const a = valutaDeposito(
      { cer: [cer(null, { residuoKg: 29000 })] },
      quantitativo({ preavvisoPercentuale: 0 }),
      '2026-10-28'
    )
    expect(a).toEqual([])
  })

  it('messaggio: quantità formattata e frase sulla conversione', () => {
    const a = valutaDeposito(
      { cer: [cer(null, { residuoKg: 30000 })] },
      quantitativo(),
      '2026-10-28'
    )
    expect(a[0].messaggio).toContain('30.000 kg')
    expect(a[0].messaggio).toContain("conversione indicata dall'azienda")
    expect(a[0].messaggio).toContain('30 m³')
  })
})

describe('valutaDeposito: testi di preavviso (F3)', () => {
  const preavviso = (kg: number, perc: number) =>
    valutaDeposito(
      { cer: [cer(null, { residuoKg: kg })] },
      quantitativo({ preavvisoPercentuale: perc }),
      '2026-10-28'
    )[0]

  it('preavviso 80: testo grammaticale con percentuale configurata e reale', () => {
    expect(preavviso(25000, 80).messaggio).toContain(
      'Rifiuti in deposito: 25.000 kg, è vicino alla soglia di 30.000 kg (percentuale di preavviso: 80%; raggiunto: 83%).'
    )
  })

  it.each([10, 50, 11, 80])('percentuale %i: nessuna preposizione davanti al numero', perc => {
    const m = preavviso(30000 * (perc / 100) + 300, perc).messaggio
    expect(m).toContain(`percentuale di preavviso: ${perc}%`)
    expect(m).not.toMatch(/(all'|\bal|\bdi la)\s*\d/)
    expect(m).not.toContain('di la soglia')
  })

  it('il superamento resta "ha raggiunto"', () => {
    expect(preavviso(30000, 80).messaggio).toContain(
      'Rifiuti in deposito: 30.000 kg, ha raggiunto la soglia di 30.000 kg.'
    )
  })
})

describe('valutaDeposito: unità miste (F1)', () => {
  it("l'avviso di durata del CER con unità miste porta la nota", () => {
    const a = valutaDeposito(
      { cer: [cer('2026-01-01', { unitaMiste: true })] },
      temporale(),
      '2026-10-28'
    )
    expect(a[0].tipo).toBe('DURATA')
    expect(a[0].messaggio).toContain("verifica l'unità del FIR")
  })

  it('senza unità miste nessuna nota', () => {
    const a = valutaDeposito({ cer: [cer('2026-01-01')] }, temporale(), '2026-10-28')
    expect(a[0].messaggio).not.toContain('unità diversa')
  })
})

describe('valutaDeposito: criteri e ordinamento', () => {
  it('TEMPORALE non produce avvisi quantitativi', () => {
    const a = valutaDeposito({ cer: [cer(null, { residuoKg: 99999 })] }, temporale(), '2026-10-28')
    expect(a).toEqual([])
  })

  it('QUANTITATIVO produce DURATA_ANNUALE e non DURATA', () => {
    const s = quantitativo()
    const dur = (oggi: string) =>
      valutaDeposito({ cer: [cer('2025-10-28')] }, s, oggi).filter(x => x.tipo.startsWith('DURATA'))
    expect(dur('2026-10-29')).toHaveLength(1)
    expect(dur('2026-10-29')[0]).toMatchObject({ tipo: 'DURATA_ANNUALE', livello: 'SUPERATO' })
    expect(dur('2026-10-28')[0]).toMatchObject({ tipo: 'DURATA_ANNUALE', livello: 'PREAVVISO' })
    expect(dur('2026-10-12')).toEqual([])
    expect(dur('2026-10-13')[0].livello).toBe('PREAVVISO')
  })

  it('NON_SCELTO produce durata e quantità (senza annuale) con la frase costante', () => {
    const a = valutaDeposito(
      { cer: [cer('2025-10-01', { residuoKg: 30000 })] },
      SOGLIE_PREDEFINITE,
      '2026-10-28'
    )
    expect(a.map(x => x.tipo).sort()).toEqual(['DURATA', 'QUANTITA_TOTALE'])
    for (const x of a) expect(x.messaggio.endsWith(FRASE_CRITERIO_NON_SCELTO)).toBe(true)
  })

  it('SUPERATO prima di PREAVVISO', () => {
    const input: InputValutazione = {
      cer: [
        cer('2026-08-01', { cerCode: 'A', residuoKg: 24000 }),
        cer('2026-07-01', { cerCode: 'B', residuoKg: 0 }),
      ],
    }
    const a = valutaDeposito(input, SOGLIE_PREDEFINITE, '2026-10-20')
    const livelli = a.map(x => x.livello)
    const primoPreavviso = livelli.indexOf('PREAVVISO')
    expect(primoPreavviso).toBeGreaterThan(0)
    expect(livelli.slice(primoPreavviso)).not.toContain('SUPERATO')
    expect(a[0]).toMatchObject({ tipo: 'DURATA', livello: 'SUPERATO', cerCode: 'B' })
  })
})

describe('correzioni di revisione', () => {
  it('data inesistente: Error', () => {
    expect(() => aggiungiGiorni('2026-02-30', 1)).toThrow('Giorno non valido')
    expect(() => giorniTra('2026-13-01', '2026-12-01')).toThrow('Giorno non valido')
  })

  it('scadenze coincidenti: il motivo dice tre mesi', () => {
    // 01/02 + 89 giorni = 01/05 = tre mesi
    const a = valutaDeposito(
      { cer: [cer('2026-02-01')] },
      temporale({ giorniMax: 89 }),
      '2026-05-02'
    )
    expect(a[0].messaggio).toContain('(tre mesi)')
  })

  it('valori in kg senza deriva di virgola mobile', () => {
    const a = valutaDeposito(
      { cer: [cer(null, { residuoKg: 0.1 }), cer(null, { residuoKg: 0.2 })] },
      quantitativo({ kgMaxTotale: 0.3, kgMaxPericolosi: 0.3, preavvisoPercentuale: 0 }),
      '2026-10-28'
    )
    expect(a[0].valore).toBe(0.3)
  })
})
