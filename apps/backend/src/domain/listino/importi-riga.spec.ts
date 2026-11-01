import {
  arrotonda,
  arrotonda2,
  cascataValida,
  importoRiga,
  normalizzaCascata,
  oreDecimali,
  prezzoCalcolato,
  provvigioneRiga,
  quantitaDaMovimento,
  scontoCascata,
} from './importi-riga'

describe('arrotonda / arrotonda2 (E9)', () => {
  it('arrotonda a meta per eccesso in valore assoluto', () => {
    expect(arrotonda2('2.345')).toBe('2.35')
    expect(arrotonda2('-2.345')).toBe('-2.35')
    expect(arrotonda2('2.344')).toBe('2.34')
    expect(arrotonda2('2')).toBe('2.00')
  })

  it('non produce uno zero negativo', () => {
    expect(arrotonda2('-0.001')).toBe('0.00')
  })

  it('arrotonda a un numero di decimali qualsiasi', () => {
    expect(arrotonda('0.01375', 4)).toBe('0.0138')
    expect(arrotonda('1.5', 0)).toBe('2')
  })
})

describe('prezzoCalcolato (R4)', () => {
  it('almeno due decimali, senza zeri finali oltre il secondo', () => {
    expect(prezzoCalcolato('0.8')).toBe('0.80')
    expect(prezzoCalcolato('10.5000')).toBe('10.50')
    expect(prezzoCalcolato('0.013800')).toBe('0.0138')
    expect(prezzoCalcolato('3')).toBe('3.00')
  })
})

describe('normalizzaCascata e cascataValida (E10)', () => {
  it('normalizza spazi e virgola italiana', () => {
    expect(normalizzaCascata('10 + 5,5')).toBe('10+5.5')
    expect(normalizzaCascata('  ')).toBeNull()
    expect(normalizzaCascata(null)).toBeNull()
    expect(normalizzaCascata(undefined)).toBeNull()
  })

  it.each(['10', '10+5', '10+5.5+99.99', '0.5', '99.99'])('accetta %s', f => {
    expect(cascataValida(f)).toBe(true)
  })

  it('assenza di sconto e valida', () => {
    expect(cascataValida(null)).toBe(true)
  })

  it.each(['10++5', '10+5+2+1', '100', '.5', '5.', '1.2.3', '1,2,3', '5+', '+5', '10.555', 'a'])(
    'rifiuta %s',
    f => {
      expect(cascataValida(normalizzaCascata(f) ?? '')).toBe(false)
    }
  )

  it('rifiuta i casi con virgola dopo la normalizzazione', () => {
    expect(cascataValida(normalizzaCascata(',5'))).toBe(false)
    expect(cascataValida(normalizzaCascata('5,'))).toBe(false)
    expect(cascataValida(normalizzaCascata('1,2,3'))).toBe(false)
  })
})

describe('scontoCascata (E9)', () => {
  it('applica ogni termine al residuo', () => {
    expect(scontoCascata('100.00', '10+5')).toBe('14.50')
    expect(scontoCascata('33.33', '10')).toBe('3.33')
  })

  it('senza formula lo sconto e zero', () => {
    expect(scontoCascata('100.00', null)).toBe('0.00')
  })

  it('senza errori da virgola mobile', () => {
    expect(scontoCascata('0.30', '10')).toBe('0.03')
  })

  it('arrotonda solo la somma finale, non il residuo di ogni passo', () => {
    // esatto: 0,505 + 0,47975 = 0,98475 -> 0,98 (passo per passo darebbe 0,51 + 0,48 = 0,99)
    expect(scontoCascata('10.10', '5+5')).toBe('0.98')
  })
})

describe('importoRiga (E9)', () => {
  it('niente number: 3 x 0,1 fa esattamente 0,30', () => {
    expect(importoRiga('3', '0.1', null).lordo).toBe('0.30')
  })

  it('lordo arrotondato, sconto e netto', () => {
    expect(importoRiga('3', '0.3333', '')).toEqual({ lordo: '1.00', sconto: '0.00', netto: '1.00' })
    expect(importoRiga('2', '50', '10+5')).toEqual({
      lordo: '100.00',
      sconto: '14.50',
      netto: '85.50',
    })
  })
})

describe('provvigioneRiga (E9)', () => {
  const i = { lordo: '100.00', netto: '85.50' }
  it('su netto con SCONTATO', () => {
    expect(provvigioneRiga(i, '10', 'SCONTATO')).toBe('8.55')
  })
  it('su lordo con LORDO', () => {
    expect(provvigioneRiga(i, '10', 'LORDO')).toBe('10.00')
  })
  it('senza formula e zero', () => {
    expect(provvigioneRiga(i, null, 'LORDO')).toBe('0.00')
  })
})

describe('quantitaDaMovimento (xqta)', () => {
  it('peso netto: TON divide per 1000, KG resta', () => {
    expect(quantitaDaMovimento('PESO_NETTO', 'TON', { netto: '1500' })).toBe('1.5')
    expect(quantitaDaMovimento('PESO_NETTO', 'KG', { netto: '1500' })).toBe('1500')
  })
  it('peso lordo', () => {
    expect(quantitaDaMovimento('PESO_LORDO', 'TON', { lordo: '2000' })).toBe('2')
  })
  it('volume: litri -> MC divide per 1000, m3 -> LT moltiplica', () => {
    expect(quantitaDaMovimento('VOLUME', 'MC', { volume: '2500', umVolume: 'L' })).toBe('2.5')
    expect(quantitaDaMovimento('VOLUME', 'LT', { volume: '2.5', umVolume: 'M' })).toBe('2500')
    expect(quantitaDaMovimento('VOLUME', 'LT', { volume: '40', umVolume: 'L' })).toBe('40')
  })
  it('UNO vale 1, ALTRO non ha quantita', () => {
    expect(quantitaDaMovimento('UNO', 'NR', {})).toBe('1')
    expect(quantitaDaMovimento('ALTRO', 'NR', {})).toBeNull()
  })
  it('dato mancante o unita non supportata: null', () => {
    expect(quantitaDaMovimento('PESO_NETTO', 'KG', {})).toBeNull()
    expect(quantitaDaMovimento('PESO_NETTO', 'LT', { netto: '10' })).toBeNull()
    expect(quantitaDaMovimento('VOLUME', 'MC', { volume: '10' })).toBeNull()
  })
})

describe('oreDecimali (cvore)', () => {
  it('converte h,mm in ore decimali', () => {
    expect(oreDecimali('1,30')).toBe('1.5')
    expect(oreDecimali('2,45')).toBe('2.75')
    expect(oreDecimali('3')).toBe('3')
  })
  it('rifiuta minuti oltre 59', () => {
    expect(() => oreDecimali('1,75')).toThrow('I minuti vanno da 00 a 59.')
  })
})
