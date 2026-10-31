import { confrontaConRentri } from './confronto-registrazione-rentri'

const corpo = (extra: Record<string, unknown> = {}) => ({
  riferimenti: {
    numero_registrazione: { anno: 2026, progressivo: 7 },
    data_ora_registrazione: '2026-03-01T10:00:00Z',
    causale_operazione: 'DT',
  },
  rifiuto: { codice_eer: '150101', quantita: { valore: 100, unita_misura: 'kg' } },
  ...extra,
})

const dettaglio = (extra: Record<string, unknown> = {}): any => ({
  riferimenti: {
    numero_registrazione: { anno: 2026, progressivo: 7, identificativo: 'M0000000000000000007' },
    causale_operazione: 'DT',
  },
  rifiuto: { codice_eer: '150101', quantita: { valore: 100, unita_misura: 'kg' } },
  annullato: false,
  rettificato: false,
  ...extra,
})

describe('confrontaConRentri', () => {
  it('registrazione uguale: uguale e identificativo', () => {
    expect(confrontaConRentri(corpo(), 'ORDINARIA', dettaglio())).toEqual({
      uguale: true,
      identificativo: 'M0000000000000000007',
    })
  })

  it('identificativo fuori formato: uguale ma senza identificativo', () => {
    const d = dettaglio()
    d.riferimenti.numero_registrazione.identificativo = 'xx'
    expect(confrontaConRentri(corpo(), 'ORDINARIA', d)).toEqual({
      uguale: true,
      identificativo: null,
    })
  })

  it.each([
    [
      'codice EER',
      { rifiuto: { codice_eer: '150102', quantita: { valore: 100, unita_misura: 'kg' } } },
    ],
    [
      'quantita',
      { rifiuto: { codice_eer: '150101', quantita: { valore: 101, unita_misura: 'kg' } } },
    ],
    ['unita', { rifiuto: { codice_eer: '150101', quantita: { valore: 100, unita_misura: 'l' } } }],
  ])('%s diversa: non uguale', (_n, extra) => {
    expect(confrontaConRentri(corpo(), 'ORDINARIA', dettaglio(extra)).uguale).toBe(false)
  })

  it('causale diversa: non uguale', () => {
    const d = dettaglio()
    d.riferimenti.causale_operazione = 'NP'
    expect(confrontaConRentri(corpo(), 'ORDINARIA', d).uguale).toBe(false)
  })

  it('numero diverso: non uguale', () => {
    const d = dettaglio()
    d.riferimenti.numero_registrazione.progressivo = 8
    expect(confrontaConRentri(corpo(), 'ORDINARIA', d).uguale).toBe(false)
  })

  it('quantita con differenza sotto il decimillesimo: uguale', () => {
    const c = corpo({
      rifiuto: { codice_eer: '150101', quantita: { valore: 100.00004, unita_misura: 'kg' } },
    })
    expect(confrontaConRentri(c, 'ORDINARIA', dettaglio()).uguale).toBe(true)
  })

  const annullamento = {
    numero_registrazione: { anno: 2026, progressivo: 7 },
    numero_registrazione_annullata: { anno: 2026, progressivo: 3 },
    annotazioni: 'errore',
  }
  const dettaglioAnnullamento = (rettifica: unknown = { anno: 2026, progressivo: 3 }): any => ({
    riferimenti: {
      numero_registrazione: { anno: 2026, progressivo: 7, identificativo: 'M0000000000000000007' },
      numero_registrazione_rettifica: rettifica,
    },
    rifiuto: null,
    annullato: false,
    rettificato: false,
  })

  it('annullamento: uguale se numero_registrazione_rettifica coincide e rifiuto assente', () => {
    expect(confrontaConRentri(annullamento, 'ANNULLAMENTO', dettaglioAnnullamento())).toEqual({
      uguale: true,
      identificativo: 'M0000000000000000007',
    })
  })

  it.each([
    ['annullata diversa', dettaglioAnnullamento({ anno: 2026, progressivo: 4 })],
    ['campo rettifica mancante', dettaglioAnnullamento(null)],
    ['con rifiuto presente', { ...dettaglioAnnullamento(), rifiuto: { codice_eer: '150101' } }],
  ])('annullamento %s: non uguale', (_n, d) => {
    expect(confrontaConRentri(annullamento, 'ANNULLAMENTO', d as any).uguale).toBe(false)
  })

  it('annullamento: numero proprio diverso: non uguale', () => {
    const d = dettaglioAnnullamento()
    d.riferimenti.numero_registrazione.progressivo = 9
    expect(confrontaConRentri(annullamento, 'ANNULLAMENTO', d).uguale).toBe(false)
  })

  const rettifica = corpo({
    riferimenti: {
      numero_registrazione: { anno: 2026, progressivo: 7 },
      causale_operazione: 'DT',
      numero_registrazione_rettifica: { anno: 2026, progressivo: 3 },
    },
  })

  it('rettifica: uguale solo se il numero rettificato coincide (rifiuto assente ammesso)', () => {
    const d = dettaglioAnnullamento()
    expect(confrontaConRentri(rettifica, 'RETTIFICA', d).uguale).toBe(true)
    expect(
      confrontaConRentri(
        rettifica,
        'RETTIFICA',
        dettaglioAnnullamento({ anno: 2026, progressivo: 5 })
      ).uguale
    ).toBe(false)
    expect(confrontaConRentri(rettifica, 'RETTIFICA', dettaglioAnnullamento(null)).uguale).toBe(
      false
    )
    // rifiuto presente ma diverso: non uguale; presente e uguale: uguale
    expect(
      confrontaConRentri(rettifica, 'RETTIFICA', {
        ...d,
        rifiuto: { codice_eer: '200101', quantita: { valore: 1, unita_misura: 'kg' } },
      }).uguale
    ).toBe(false)
    expect(
      confrontaConRentri(rettifica, 'RETTIFICA', {
        ...d,
        rifiuto: { codice_eer: '150101', quantita: { valore: 100, unita_misura: 'kg' } },
      }).uguale
    ).toBe(true)
  })

  it('dettaglio senza dati confrontabili: non uguale (mai un si per mancanza di dati)', () => {
    expect(
      confrontaConRentri(corpo(), 'ORDINARIA', { annullato: false, rettificato: false }).uguale
    ).toBe(false)
  })

  it('dato mancante in RENTRI: nonConfrontabile (motivo diverso da "occupato")', () => {
    expect(
      confrontaConRentri(corpo(), 'ORDINARIA', { annullato: false, rettificato: false })
        .nonConfrontabile
    ).toBe(true)
    expect(
      confrontaConRentri(annullamento, 'ANNULLAMENTO', dettaglioAnnullamento(null)).nonConfrontabile
    ).toBe(true)
    // un dato diverso NON e' non-confrontabile: e' un'altra registrazione
    expect(
      confrontaConRentri(
        corpo(),
        'ORDINARIA',
        dettaglio({
          rifiuto: { codice_eer: '200101', quantita: { valore: 1, unita_misura: 'kg' } },
        })
      ).nonConfrontabile
    ).toBeUndefined()
  })
})
