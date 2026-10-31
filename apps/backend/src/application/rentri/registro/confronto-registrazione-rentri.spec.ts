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

  it('annullamento: conta il numero, il corpo non ha rifiuto', () => {
    const c = {
      numero_registrazione: { anno: 2026, progressivo: 7 },
      numero_registrazione_annullata: { anno: 2026, progressivo: 3 },
      annotazioni: 'errore',
    }
    expect(confrontaConRentri(c, 'ANNULLAMENTO', dettaglio()).uguale).toBe(true)
    const d = dettaglio()
    d.riferimenti.numero_registrazione.progressivo = 9
    expect(confrontaConRentri(c, 'ANNULLAMENTO', d).uguale).toBe(false)
  })

  it('dettaglio senza dati confrontabili: non uguale (mai un si per mancanza di dati)', () => {
    expect(
      confrontaConRentri(corpo(), 'ORDINARIA', { annullato: false, rettificato: false }).uguale
    ).toBe(false)
  })
})
