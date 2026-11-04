import {
  avvisiDaRighe,
  copiaValoriDaRiga,
  motiviRighe,
  puoModificarePrezzoRiga,
  validaPrezzoManuale,
  validaQuantitaManuale,
  validaScontoManuale,
  type RigaLegameValori,
} from './valori-legame'
import { STATI_LEGAME, type StatoLegame } from './codici'

const riga = (o: Partial<RigaLegameValori> = {}): RigaLegameValori => ({
  rigaAddebitoId: 'r1',
  origine: 'PRINCIPALE',
  prezzoSpeciale: false,
  prezzo: '10.00',
  sconto: null,
  quantita: '5',
  quantitaOrigine: 'DA_MOVIMENTO',
  prezzoManuale: false,
  codiceIvaId: 'iva1',
  ...o,
})

describe('motiviRighe', () => {
  it('righe complete: nessun motivo', () => {
    expect(motiviRighe([riga()])).toEqual([])
    expect(motiviRighe([])).toEqual([])
  })
  it('prezzo "0" esplicito su riga non speciale: nessun motivo', () => {
    expect(motiviRighe([riga({ prezzo: '0' })])).toEqual([])
    expect(motiviRighe([riga({ prezzo: '0.00' })])).toEqual([])
  })
  it('prezzo null su riga non speciale: SENZA_PREZZO', () => {
    expect(motiviRighe([riga({ prezzo: null })])).toEqual(['SENZA_PREZZO'])
  })
  it('prezzo speciale con prezzo null: nessun motivo', () => {
    expect(motiviRighe([riga({ prezzoSpeciale: true, prezzo: null })])).toEqual([])
  })
  it('quantita null: SENZA_QUANTITA', () => {
    expect(motiviRighe([riga({ quantita: null, quantitaOrigine: null })])).toEqual([
      'SENZA_QUANTITA',
    ])
  })
  it('quantita "0" non e un motivo (la verifica e di chi la scrive a mano)', () => {
    expect(motiviRighe([riga({ quantita: '0' })])).toEqual([])
  })
  it('senza duplicati e nell ordine dei codici, su piu righe', () => {
    const r = motiviRighe([
      riga({ rigaAddebitoId: 'a', quantita: null, quantitaOrigine: null }),
      riga({ rigaAddebitoId: 'b', prezzo: null }),
      riga({ rigaAddebitoId: 'c', prezzo: null }),
    ])
    expect(r).toEqual(['SENZA_PREZZO', 'SENZA_QUANTITA'])
  })
})

describe('validaQuantitaManuale', () => {
  it.each(['12.5', '0.001', '7', '12345678901.5'])('%s e valida', v => {
    expect(validaQuantitaManuale(v)).toEqual({ ok: true, valore: v })
  })
  it.each(['0', '0.000', '-3', '1,5', '1.2345', '', ' ', '1e3', '.5', '5.', 'abc', '123456789012'])(
    '"%s" e rifiutata',
    v => {
      const r = validaQuantitaManuale(v)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errore.length).toBeGreaterThan(0)
    }
  )
  it('un numero JSON, null o undefined sono rifiutati', () => {
    expect(validaQuantitaManuale(12.5).ok).toBe(false)
    expect(validaQuantitaManuale(null).ok).toBe(false)
    expect(validaQuantitaManuale(undefined).ok).toBe(false)
  })
  it('la virgola ha il suo messaggio', () => {
    const r = validaQuantitaManuale('1,5')
    expect(r).toEqual({ ok: false, errore: expect.stringContaining('virgola') })
  })
})

describe('validaPrezzoManuale', () => {
  it.each(['0', '10', '10.123456', '0.000001', '12345678.5'])('%s e valido', v => {
    expect(validaPrezzoManuale(v)).toEqual({ ok: true, valore: v })
  })
  it.each(['-1', '10.1234567', '10,5', '', 'x', '.5', '123456789'])('"%s" e rifiutato', v => {
    expect(validaPrezzoManuale(v).ok).toBe(false)
  })
  it('un numero JSON, null o undefined sono rifiutati', () => {
    expect(validaPrezzoManuale(10).ok).toBe(false)
    expect(validaPrezzoManuale(0).ok).toBe(false)
    expect(validaPrezzoManuale(null).ok).toBe(false)
    expect(validaPrezzoManuale(undefined).ok).toBe(false)
  })
})

describe('validaScontoManuale', () => {
  it('null e "10+5" (cascata valida) sono ammessi', () => {
    expect(validaScontoManuale(null)).toEqual({ ok: true, valore: null })
    expect(validaScontoManuale('10+5')).toEqual({ ok: true, valore: '10+5' })
    expect(validaScontoManuale('10+5+2.5')).toEqual({ ok: true, valore: '10+5+2.5' })
  })
  it('stringa vuota = nessuno sconto', () => {
    expect(validaScontoManuale('')).toEqual({ ok: true, valore: null })
  })
  it('formule non valide: errore', () => {
    for (const v of ['10+', '1+2+3+4', '100', 'abc', '10++5', '-5']) {
      expect(validaScontoManuale(v).ok).toBe(false)
    }
  })
  it('un numero JSON e rifiutato', () => {
    expect(validaScontoManuale(10).ok).toBe(false)
  })
  it('la virgola e normalizzata, come nelle formule del listino', () => {
    expect(validaScontoManuale('10+5,5')).toEqual({ ok: true, valore: '10+5.5' })
  })
})

describe('avvisiDaRighe', () => {
  it('una riga manuale aggiunge PREZZO_MANUALE senza duplicarlo', () => {
    expect(avvisiDaRighe([], [{ prezzoManuale: true }, { prezzoManuale: true }])).toEqual([
      'PREZZO_MANUALE',
    ])
    expect(avvisiDaRighe(['PREZZO_MANUALE'], [{ prezzoManuale: true }])).toEqual(['PREZZO_MANUALE'])
  })
  it('nessuna riga manuale lo toglie', () => {
    expect(avvisiDaRighe(['PREZZO_MANUALE'], [{ prezzoManuale: false }])).toEqual([])
    expect(avvisiDaRighe(['PREZZO_MANUALE'], [])).toEqual([])
  })
  it('gli altri avvisi restano', () => {
    expect(
      avvisiDaRighe(['CLIENTE_NON_DA_FIR', 'CAMBIO_CER_DA_CONFERMARE'], [{ prezzoManuale: true }])
    ).toEqual(['CLIENTE_NON_DA_FIR', 'CAMBIO_CER_DA_CONFERMARE', 'PREZZO_MANUALE'])
    expect(avvisiDaRighe(['CLIENTE_NON_DA_FIR', 'PREZZO_MANUALE'], [])).toEqual([
      'CLIENTE_NON_DA_FIR',
    ])
  })
  it('non modifica l array ricevuto', () => {
    const attuali = ['CLIENTE_NON_DA_FIR'] as const
    avvisiDaRighe(attuali, [{ prezzoManuale: true }])
    expect(attuali).toEqual(['CLIENTE_NON_DA_FIR'])
  })
})

describe('puoModificarePrezzoRiga', () => {
  it('falso per FATTURATO, IMPORTATO_FATTURATO, ESCLUSO, ANNULLATO', () => {
    for (const stato of ['FATTURATO', 'IMPORTATO_FATTURATO', 'ESCLUSO', 'ANNULLATO'] as const) {
      expect(puoModificarePrezzoRiga({ stato, prezzoSpeciale: false })).toBe(false)
    }
  })
  it('falso per riga a prezzo speciale in ogni stato', () => {
    for (const stato of STATI_LEGAME as readonly StatoLegame[]) {
      expect(puoModificarePrezzoRiga({ stato, prezzoSpeciale: true })).toBe(false)
    }
  })
  it('vero per DA_COLLEGARE, PROPOSTO, CONFERMATO su riga a prezzo singolo', () => {
    for (const stato of ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO'] as const) {
      expect(puoModificarePrezzoRiga({ stato, prezzoSpeciale: false })).toBe(true)
    }
  })
})

describe('copiaValoriDaRiga', () => {
  const iva = { id: 'iva1', aliquota: '22.00', natura: null }
  it('copia prezzo, sconto e IVA; prezzoManuale e sempre false', () => {
    expect(
      copiaValoriDaRiga({ prezzo: '12.5', prezzoSpeciale: false, sconto: '10+5', codiceIva: iva })
    ).toEqual({
      prezzo: '12.5',
      sconto: '10+5',
      codiceIvaId: 'iva1',
      aliquotaIva: '22.00',
      naturaIva: null,
      prezzoManuale: false,
    })
  })
  it('conserva il prezzo zero esplicito', () => {
    expect(
      copiaValoriDaRiga({ prezzo: '0', prezzoSpeciale: false, sconto: null, codiceIva: iva }).prezzo
    ).toBe('0')
  })
  it('su riga speciale: prezzo e sconto null, IVA copiata', () => {
    expect(
      copiaValoriDaRiga({
        prezzo: '9.00',
        prezzoSpeciale: true,
        sconto: '5',
        codiceIva: { id: 'iva2', aliquota: '0.00', natura: 'N2.2' },
      })
    ).toEqual({
      prezzo: null,
      sconto: null,
      codiceIvaId: 'iva2',
      aliquotaIva: '0.00',
      naturaIva: 'N2.2',
      prezzoManuale: false,
    })
  })
})

describe('zeri iniziali (M6)', () => {
  it('quantita: gli zeri iniziali non contano come cifre e si normalizzano', () => {
    expect(validaQuantitaManuale('000000000001')).toEqual({ ok: true, valore: '1' })
    expect(validaQuantitaManuale('007.50')).toEqual({ ok: true, valore: '7.50' })
    expect(validaQuantitaManuale('0.5')).toEqual({ ok: true, valore: '0.5' })
    expect(validaQuantitaManuale('000.000').ok).toBe(false)
  })
  it('prezzo: zero resta zero, zeri iniziali tolti', () => {
    expect(validaPrezzoManuale('000')).toEqual({ ok: true, valore: '0' })
    expect(validaPrezzoManuale('0012.5')).toEqual({ ok: true, valore: '12.5' })
  })
})
