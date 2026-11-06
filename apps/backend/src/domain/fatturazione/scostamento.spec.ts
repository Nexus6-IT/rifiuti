import { tipoCorrezioneScostamento, valoreAttualeScostamento } from './scostamento'

type Riga = Parameters<typeof valoreAttualeScostamento>[0]['fatturato'][number]

const riga = (p: Partial<Riga> = {}): Riga => ({
  quantita: '1000.000',
  prezzoTotale: '100.00',
  prezzoUnitario: '0.10',
  sconto: null,
  tipoRiga: 'MOVIMENTO',
  prezzoSpeciale: false,
  tipoQuantita: 'PESO_NETTO',
  unitaMisura: 'KG',
  quantitaOrigine: 'DA_MOVIMENTO',
  ...p,
})

const testa = (quantity: string | null, annullato = false, unit = 'KG') => ({
  quantity,
  unit,
  annullato,
})

describe('valoreAttualeScostamento', () => {
  it('rettifica da 1000 a 1200 kg a 0.10: attuale 120.00', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga()],
      testa: testa('1200.000'),
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
      testa: testa('1000.000', true),
    })
    expect(v).toEqual({ quantitaAttuale: '0.000', importoAttuale: '0.00', soloQuantita: false })
  })

  it('riga a prezzo speciale (prezzo 0): solo quantità, importo null', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga({ prezzoUnitario: '0.00', prezzoTotale: '0.00', prezzoSpeciale: true })],
      testa: testa('1200.000'),
    })
    expect(v).toEqual({ quantitaAttuale: '1200.000', importoAttuale: null, soloQuantita: true })
  })

  it('due righe MOVIMENTO (CER a 0.10 e V a 0.02): attuale 144.00', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga(), riga({ prezzoUnitario: '0.02', prezzoTotale: '20.00' })],
      testa: testa('1200.000'),
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
      testa: testa('1200.000'),
    })
    expect(v).toEqual({ quantitaAttuale: '1200.000', importoAttuale: null, soloQuantita: true })
  })

  it('applica lo sconto a cascata della riga', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga({ sconto: '10+5', prezzoTotale: '85.50' })],
      testa: testa('2000.000'),
    })
    // 2000 x 0.10 = 200.00, meno 10% = 180.00, meno 5% = 171.00
    expect(v.importoAttuale).toBe('171.00')
  })

  it('ignora le righe che non sono MOVIMENTO', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga(), riga({ tipoRiga: 'FISSO', prezzoUnitario: '50.00' })],
      testa: testa('1200.000'),
    })
    expect(v.importoAttuale).toBe('120.00')
  })

  it('senza righe MOVIMENTO o senza quantità della testa: importo null', () => {
    expect(
      valoreAttualeScostamento({ fatturato: [], testa: testa('5.000') }).importoAttuale
    ).toBeNull()
    const v = valoreAttualeScostamento({
      fatturato: [riga()],
      testa: testa(null),
    })
    expect(v).toEqual({ quantitaAttuale: null, importoAttuale: null, soloQuantita: false })
  })

  it('C1: riga a 100 euro/tonnellata, 1000 kg fatturati e rettifica a 1200 kg: attuale 120.00, non 120000.00', () => {
    const v = valoreAttualeScostamento({
      fatturato: [
        riga({
          quantita: '1',
          unitaMisura: 'TON',
          prezzoUnitario: '100.00',
          prezzoTotale: '100.00',
        }),
      ],
      testa: testa('1200.000'),
    })
    expect(v.importoAttuale).toBe('120.00')
    expect(v.quantitaAttuale).toBe('1200.000')
  })

  it('C1: testa in tonnellate su riga in kg: converte nella UM della riga', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga()],
      testa: testa('1.2', false, 'T'),
    })
    expect(v.importoAttuale).toBe('120.00')
  })

  it('C1: riga UNO (viaggio a 50 euro): l’attuale resta quello fatturato, anche se la quantità cambia', () => {
    const v = valoreAttualeScostamento({
      fatturato: [
        riga({
          tipoQuantita: 'UNO',
          unitaMisura: 'NR',
          quantita: '1',
          prezzoUnitario: '50.00',
          prezzoTotale: '50.00',
        }),
      ],
      testa: testa('1200.000'),
    })
    expect(v.importoAttuale).toBe('50.00')
  })

  it('C1: riga MANUALE: l’attuale resta quello fatturato; la riga DA_MOVIMENTO accanto si ricalcola', () => {
    const v = valoreAttualeScostamento({
      fatturato: [
        riga({
          quantitaOrigine: 'MANUALE',
          quantita: '3.000',
          prezzoUnitario: '10.00',
          prezzoTotale: '30.00',
        }),
        riga(),
      ],
      testa: testa('1200.000'),
    })
    expect(v.importoAttuale).toBe('150.00')
  })

  it('C1: annullo: le righe UNO e MANUALE restano, quelle da movimento vanno a zero', () => {
    const v = valoreAttualeScostamento({
      fatturato: [
        riga({
          tipoQuantita: 'UNO',
          unitaMisura: 'NR',
          quantita: '1',
          prezzoUnitario: '50.00',
          prezzoTotale: '50.00',
        }),
        riga(),
      ],
      testa: testa('1000.000', true),
    })
    expect(v.importoAttuale).toBe('50.00')
  })

  it('C1: conversione impossibile (unità della testa sconosciuta): importo null', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga()],
      testa: testa('5', false, 'XX'),
    })
    expect(v.importoAttuale).toBeNull()
  })

  it('m1: una riga a prezzo singolo con prezzo 0 (omaggio) non è a prezzo speciale: importo 0.00', () => {
    const v = valoreAttualeScostamento({
      fatturato: [riga({ prezzoUnitario: '0.00', prezzoTotale: '0.00' })],
      testa: testa('1200.000'),
    })
    expect(v).toEqual({ quantitaAttuale: '1200.000', importoAttuale: '0.00', soloQuantita: false })
  })
})

describe('tipoCorrezioneScostamento', () => {
  const base = {
    tipoAnnotazione: 'RETTIFICA' as const,
    cerTesta: '20 03 01',
    cerFatturato: '20 03 01',
    quantitaTesta: '1200.000',
    unitaTesta: 'KG',
    quantitaFatturata: '1000.000',
    unitaFatturata: 'KG',
    causaleTesta: 'INGRESSO_ESTERNO',
    causaleFatturata: 'INGRESSO_ESTERNO',
  }
  it('ANNULLAMENTO è ANNULLO', () => {
    expect(tipoCorrezioneScostamento({ ...base, tipoAnnotazione: 'ANNULLAMENTO' })).toBe('ANNULLO')
  })
  it('quantità diversa è RETTIFICA', () => {
    expect(tipoCorrezioneScostamento(base)).toBe('RETTIFICA')
  })
  it('unità diversa con la stessa quantità è RETTIFICA', () => {
    expect(tipoCorrezioneScostamento({ ...base, quantitaTesta: '1000', unitaTesta: 'T' })).toBe(
      'RETTIFICA'
    )
  })
  it('CER diverso è CAMBIO_CER', () => {
    expect(tipoCorrezioneScostamento({ ...base, cerTesta: '20 03 07' })).toBe('CAMBIO_CER')
  })
  it('causale diversa, resto uguale, è CAMBIO_CAUSALE', () => {
    expect(
      tipoCorrezioneScostamento({ ...base, quantitaTesta: '1000', causaleTesta: 'RIENTRO' })
    ).toBe('CAMBIO_CAUSALE')
  })
  it('stessa quantità e stessa causale (cambia altro, es. la data): RETTIFICA', () => {
    expect(tipoCorrezioneScostamento({ ...base, quantitaTesta: '1000' })).toBe('RETTIFICA')
  })
  it('quantità e causale diverse: RETTIFICA (vince la quantità)', () => {
    expect(tipoCorrezioneScostamento({ ...base, causaleTesta: 'RIENTRO' })).toBe('RETTIFICA')
  })
})
