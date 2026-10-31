import {
  AVVISO_MANUALE,
  AVVISO_RETTIFICATO,
  AVVISO_SINGOLA,
  AVVISO_TARA_DICHIARATA,
  calcolaNetto,
  pesoEffettivo,
  type PesataPerNetto,
} from './netto-accesso'

const OGGI = '2026-10-31'

function pesata(
  p: Partial<PesataPerNetto> & Pick<PesataPerNetto, 'ordine' | 'pesoKg'>
): PesataPerNetto {
  return { fonte: 'STRUMENTO', rettifiche: [], stabile: true, ...p }
}

describe('calcolaNetto', () => {
  it('DOPPIA CARICO: 24.880 e 12.540 → netto 12.340, DUE_PESATE', () => {
    const e = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [pesata({ ordine: 1, pesoKg: 24880 }), pesata({ ordine: 2, pesoKg: 12540 })],
      OGGI
    )
    expect(e).toMatchObject({
      stato: 'CALCOLATO',
      lordoKg: 24880,
      taraKg: 12540,
      nettoKg: 12340,
      qualita: 'DUE_PESATE',
      errore: null,
    })
    expect(e.avvisi).toEqual([])
  })

  it('DOPPIA SCARICO: prima 12.540 (tara), seconda 24.880 → netto 12.340', () => {
    const e = calcolaNetto(
      'SCARICO',
      'DOPPIA',
      [pesata({ ordine: 1, pesoKg: 12540 }), pesata({ ordine: 2, pesoKg: 24880 })],
      OGGI
    )
    expect(e).toMatchObject({ stato: 'CALCOLATO', lordoKg: 24880, taraKg: 12540, nettoKg: 12340 })
  })

  it('DOPPIA con una sola pesata → INCOMPLETO, netto null', () => {
    const e = calcolaNetto('CARICO', 'DOPPIA', [pesata({ ordine: 1, pesoKg: 24880 })], OGGI)
    expect(e.stato).toBe('INCOMPLETO')
    expect(e.nettoKg).toBeNull()
  })

  it('lordo 24.880 tara 25.000 → NON_VALIDO con errore che cita entrambi i pesi', () => {
    const e = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [pesata({ ordine: 1, pesoKg: 24880 }), pesata({ ordine: 2, pesoKg: 25000 })],
      OGGI
    )
    expect(e.stato).toBe('NON_VALIDO')
    expect(e.nettoKg).toBeNull()
    expect(e.errore).toBe(
      'Il lordo (24.880 kg) non supera la tara (25.000 kg): il netto non si può calcolare.'
    )
  })

  it('lordo uguale alla tara → NON_VALIDO', () => {
    const e = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [pesata({ ordine: 1, pesoKg: 20000 }), pesata({ ordine: 2, pesoKg: 20000 })],
      OGGI
    )
    expect(e.stato).toBe('NON_VALIDO')
  })

  it('TARA_ANAGRAFICA SCARICO: ordine 1 è il lordo, ordine 2 la tara dichiarata', () => {
    const e = calcolaNetto(
      'SCARICO',
      'TARA_ANAGRAFICA',
      [
        pesata({ ordine: 1, pesoKg: 24880 }),
        pesata({
          ordine: 2,
          pesoKg: 12540,
          fonte: 'TARA_ANAGRAFICA',
          taraAggiornataIl: '2026-10-01T08:00:00Z',
        }),
      ],
      OGGI
    )
    expect(e).toMatchObject({
      stato: 'CALCOLATO',
      lordoKg: 24880,
      taraKg: 12540,
      nettoKg: 12340,
      qualita: 'TARA_DICHIARATA',
    })
    expect(e.avvisi).toContain(AVVISO_TARA_DICHIARATA)
  })

  it('tara aggiornata 366 giorni prima di oggi → avviso tara vecchia; 365 → nessun avviso', () => {
    const con = (iso: string) =>
      calcolaNetto(
        'CARICO',
        'TARA_ANAGRAFICA',
        [
          pesata({ ordine: 1, pesoKg: 24880 }),
          pesata({ ordine: 2, pesoKg: 12540, fonte: 'TARA_ANAGRAFICA', taraAggiornataIl: iso }),
        ],
        OGGI
      )
    // 2025-10-30 → 366 giorni; 2025-10-31 → 365 giorni
    expect(con('2025-10-30T10:00:00Z').avvisi).toContain(
      'Tara dichiarata aggiornata il 30/10/2025, più di 365 giorni fa.'
    )
    expect(con('2025-10-31T10:00:00Z').avvisi).toEqual([AVVISO_TARA_DICHIARATA])
  })

  it('SINGOLA: netto = peso, lordo e tara null, AVVISO_SINGOLA', () => {
    const e = calcolaNetto('CARICO', 'SINGOLA', [pesata({ ordine: 1, pesoKg: 8120 })], OGGI)
    expect(e).toMatchObject({
      stato: 'CALCOLATO',
      nettoKg: 8120,
      lordoKg: null,
      taraKg: null,
      qualita: 'PESATA_SINGOLA',
    })
    expect(e.avvisi).toContain(AVVISO_SINGOLA)
  })

  it('una pesata MANUALE → manuale true e AVVISO_MANUALE', () => {
    const e = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [
        pesata({ ordine: 1, pesoKg: 24880, fonte: 'MANUALE' }),
        pesata({ ordine: 2, pesoKg: 12540 }),
      ],
      OGGI
    )
    expect(e.manuale).toBe(true)
    expect(e.avvisi).toContain(AVVISO_MANUALE)
  })

  it('rettifiche 3 e 1 in disordine: vale la numero 3', () => {
    const p = pesata({
      ordine: 1,
      pesoKg: 24880,
      rettifiche: [
        { numero: 3, pesoNuovoKg: 24900 },
        { numero: 1, pesoNuovoKg: 24000 },
      ],
    })
    expect(pesoEffettivo(p)).toBe(24900)
    const e = calcolaNetto('CARICO', 'DOPPIA', [p, pesata({ ordine: 2, pesoKg: 12540 })], OGGI)
    expect(e.nettoKg).toBe(12360)
    expect(e.rettificato).toBe(true)
    expect(e.avvisi).toContain(AVVISO_RETTIFICATO)
  })

  it('stabile false → NON_VALIDO "Una pesata instabile non è un peso."', () => {
    const e = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [pesata({ ordine: 1, pesoKg: 24880, stabile: false }), pesata({ ordine: 2, pesoKg: 12540 })],
      OGGI
    )
    expect(e.stato).toBe('NON_VALIDO')
    expect(e.errore).toBe('Una pesata instabile non è un peso.')
  })

  it('0,1 + centesimi: 1000,05 − 999,95 = 0,10 esatto', () => {
    const e = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [pesata({ ordine: 1, pesoKg: 1000.05 }), pesata({ ordine: 2, pesoKg: 999.95 })],
      OGGI
    )
    expect(e.nettoKg).toBe(0.1)
  })

  it('la tara vecchia segue il giorno di Roma: 2025-10-30T23:30Z è il 31/10, quindi 365 giorni → nessun avviso', () => {
    const e = calcolaNetto(
      'CARICO',
      'TARA_ANAGRAFICA',
      [
        pesata({ ordine: 1, pesoKg: 24880 }),
        pesata({
          ordine: 2,
          pesoKg: 12540,
          fonte: 'TARA_ANAGRAFICA',
          taraAggiornataIl: '2025-10-30T23:30:00Z',
        }),
      ],
      OGGI
    )
    expect(e.avvisi).toEqual([AVVISO_TARA_DICHIARATA])
  })

  it("la data nell'avviso è quella di Roma: 2025-10-29T23:30Z → 30/10/2025", () => {
    const e = calcolaNetto(
      'CARICO',
      'TARA_ANAGRAFICA',
      [
        pesata({ ordine: 1, pesoKg: 24880 }),
        pesata({
          ordine: 2,
          pesoKg: 12540,
          fonte: 'TARA_ANAGRAFICA',
          taraAggiornataIl: '2025-10-29T23:30:00Z',
        }),
      ],
      OGGI
    )
    expect(e.avvisi).toContain('Tara dichiarata aggiornata il 30/10/2025, più di 365 giorni fa.')
  })

  it('i rami NON_VALIDO portano gli avvisi manuale e rettificato', () => {
    const e = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [
        pesata({
          ordine: 1,
          pesoKg: 20000,
          fonte: 'MANUALE',
          rettifiche: [{ numero: 1, pesoNuovoKg: 24000 }],
        }),
        pesata({ ordine: 2, pesoKg: 25000 }),
      ],
      OGGI
    )
    expect(e.stato).toBe('NON_VALIDO')
    expect(e.avvisi).toEqual([AVVISO_MANUALE, AVVISO_RETTIFICATO])
    const i = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [pesata({ ordine: 1, pesoKg: 24880, fonte: 'MANUALE', stabile: false })],
      OGGI
    )
    expect(i.avvisi).toEqual([AVVISO_MANUALE])
    const inc = calcolaNetto(
      'CARICO',
      'DOPPIA',
      [pesata({ ordine: 1, pesoKg: 24880, fonte: 'MANUALE' })],
      OGGI
    )
    expect(inc.avvisi).toEqual([AVVISO_MANUALE])
  })

  it('SINGOLA con netto zero → NON_VALIDO e porta gli avvisi manuale e rettificato', () => {
    const e = calcolaNetto(
      'CARICO',
      'SINGOLA',
      [
        pesata({
          ordine: 1,
          pesoKg: 8120,
          fonte: 'MANUALE',
          rettifiche: [{ numero: 1, pesoNuovoKg: 0 }],
        }),
      ],
      OGGI
    )
    expect(e.stato).toBe('NON_VALIDO')
    expect(e.avvisi).toEqual([AVVISO_MANUALE, AVVISO_RETTIFICATO])
  })
})
