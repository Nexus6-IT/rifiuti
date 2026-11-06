import { tipoCorrezioneScostamento, valoreAttualeScostamento } from './scostamento'

type Riga = Parameters<typeof valoreAttualeScostamento>[0]['fatturato'][number]

const riga = (p: Partial<Riga> = {}): Riga => ({
  quantita: '1000.000',
  prezzoTotale: '100.00',
  prezzoUnitario: '0.10',
  sconto: null,
  tipoRiga: 'MOVIMENTO',
  prezzoSpeciale: false,
  ...p,
})

describe('valoreAttualeScostamento', () => {
  it('rettifica da 1000 a 1200 kg a 0.10: attuale 120.00', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga()],
      testa: { quantita: '1200.000', annullato: false },
    })
    expect(v).toEqual({
      quantitaAttuale: '1200.000',
      importoAttuale: '120.00',
      soloQuantita: false,
    })
  })

  it('annullo del movimento: attuale 0.00', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga()],
      testa: { quantita: '1000.000', annullato: true },
    })
    expect(v).toEqual({ quantitaAttuale: '0.000', importoAttuale: '0.00', soloQuantita: false })
  })

  it('riga a prezzo speciale (prezzo 0): solo quantità, importo null', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga({ prezzoUnitario: '0.00', prezzoTotale: '0.00', prezzoSpeciale: true })],
      testa: { quantita: '1200.000', annullato: false },
    })
    expect(v).toEqual({ quantitaAttuale: '1200.000', importoAttuale: null, soloQuantita: true })
  })

  it('due righe MOVIMENTO (CER a 0.10 e V a 0.02): attuale 144.00', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga(), riga({ prezzoUnitario: '0.02', prezzoTotale: '20.00' })],
      testa: { quantita: '1200.000', annullato: false },
    })
    expect(v.importoAttuale).toBe('144.00')
    expect(v.quantitaAttuale).toBe('1200.000')
  })

  it('una riga a prezzo singolo e una a prezzo speciale: solo quantità, importo null', () => {
    const v = valoreAttualeScostamento({
      fatturato: [
        riga(),
        riga({ prezzoUnitario: '0.00', prezzoTotale: '0.00', prezzoSpeciale: true }),
      ],
      testa: { quantita: '1200.000', annullato: false },
    })
    expect(v).toEqual({ quantitaAttuale: '1200.000', importoAttuale: null, soloQuantita: true })
  })

  it('applica lo sconto a cascata della riga', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga({ sconto: '10+5', prezzoTotale: '85.50' })],
      testa: { quantita: '2000.000', annullato: false },
    })
    // 2000 x 0.10 = 200.00, meno 10% = 180.00, meno 5% = 171.00
    expect(v.importoAttuale).toBe('171.00')
  })

  it('ignora le righe che non sono MOVIMENTO', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga(), riga({ tipoRiga: 'FISSO', prezzoUnitario: '50.00' })],
      testa: { quantita: '1200.000', annullato: false },
    })
    expect(v.importoAttuale).toBe('120.00')
  })

  it('senza righe MOVIMENTO o senza quantità della testa: importo null', () => {
    expect(
      valoreAttualeScostamento({ fatturato: [], testa: { quantita: '5.000', annullato: false } })
        .importoAttuale
    ).toBeNull()
    const v = valoreAttualeScostamento({
      fatturato: [riga()],
      testa: { quantita: null, annullato: false },
    })
    expect(v).toEqual({ quantitaAttuale: null, importoAttuale: null, soloQuantita: false })
  })
})

describe('tipoCorrezioneScostamento', () => {
  const base = {
    tipoAnnotazione: 'RETTIFICA' as const,
    cerTesta: '20 03 01',
    cerFatturato: '20 03 01',
    quantitaTesta: '1200.000',
    quantitaFatturata: '1000.000',
  }
  it('ANNULLAMENTO è ANNULLO', () => {
    expect(tipoCorrezioneScostamento({ ...base, tipoAnnotazione: 'ANNULLAMENTO' })).toBe('ANNULLO')
  })
  it('quantità diversa è RETTIFICA', () => {
    expect(tipoCorrezioneScostamento(base)).toBe('RETTIFICA')
  })
  it('CER diverso è CAMBIO_CER', () => {
    expect(tipoCorrezioneScostamento({ ...base, cerTesta: '20 03 07' })).toBe('CAMBIO_CER')
  })
  it('stessa quantità e stesso CER è CAMBIO_CAUSALE', () => {
    expect(tipoCorrezioneScostamento({ ...base, quantitaTesta: '1000' })).toBe('CAMBIO_CAUSALE')
  })
  it('CER non noto sulla riga non conta come cambio', () => {
    expect(tipoCorrezioneScostamento({ ...base, cerFatturato: null })).toBe('RETTIFICA')
  })
})
