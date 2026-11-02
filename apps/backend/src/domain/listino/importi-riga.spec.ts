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

  it('una formula non valida da un errore in italiano', () => {
    const msg = 'Le percentuali a cascata sono al massimo tre (es. 10+5), ciascuna fino a 99,99.'
    expect(() => scontoCascata('100.00', '10++5')).toThrow(msg)
    expect(() => scontoCascata('100.00', '10,5')).toThrow(msg)
    expect(() => provvigioneRiga({ lordo: '1.00', netto: '1.00' }, '100', 'LORDO')).toThrow(msg)
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
  it('peso: TON divide per 1000, ogni altra unita lascia il peso com e (GR non convertito)', () => {
    expect(quantitaDaMovimento('PESO_NETTO', 'TON', { netto: '1500' })).toBe('1.5')
    expect(quantitaDaMovimento('PESO_NETTO', 'KG', { netto: '1500' })).toBe('1500')
    expect(quantitaDaMovimento('PESO_NETTO', 'GR', { netto: '1500' })).toBe('1500')
    expect(quantitaDaMovimento('PESO_NETTO', 'LT', { netto: '10' })).toBe('10')
  })
  it('peso lordo', () => {
    expect(quantitaDaMovimento('PESO_LORDO', 'TON', { lordo: '2000' })).toBe('2')
  })
  it('volume: litri -> MC divide per 1000, m3 -> LT moltiplica', () => {
    expect(quantitaDaMovimento('VOLUME', 'MC', { volume: '2500', umVolume: 'L' })).toBe('2.5')
    expect(quantitaDaMovimento('VOLUME', 'LT', { volume: '2.5', umVolume: 'M' })).toBe('2500')
    expect(quantitaDaMovimento('VOLUME', 'LT', { volume: '40', umVolume: 'L' })).toBe('40')
    expect(quantitaDaMovimento('VOLUME', 'MC', { volume: '3', umVolume: 'M' })).toBe('3')
  })
  it('volume con unita diversa da LT/MC o senza unita del movimento: invariato', () => {
    expect(quantitaDaMovimento('VOLUME', 'KG', { volume: '12', umVolume: 'L' })).toBe('12')
    expect(quantitaDaMovimento('VOLUME', 'MC', { volume: '10' })).toBe('10')
  })
  it('UNO vale 1, ALTRO non ha quantita', () => {
    expect(quantitaDaMovimento('UNO', 'NR', {})).toBe('1')
    expect(quantitaDaMovimento('ALTRO', 'NR', {})).toBeNull()
  })
  it('dato mancante o non numerico: null', () => {
    expect(quantitaDaMovimento('PESO_NETTO', 'KG', {})).toBeNull()
    expect(quantitaDaMovimento('PESO_NETTO', 'KG', { netto: '' })).toBeNull()
    expect(quantitaDaMovimento('VOLUME', 'MC', { volume: 'abc', umVolume: 'L' })).toBeNull()
  })
})

describe('oreDecimali (cvore)', () => {
  it('converte h,mm in ore decimali con almeno due decimali', () => {
    expect(oreDecimali('1,30')).toBe('1.50')
    expect(oreDecimali('2,45')).toBe('2.75')
    expect(oreDecimali('2')).toBe('2.00')
  })
  it('i minuti sono l intero dopo la virgola, senza riempimento e senza limite', () => {
    expect(oreDecimali('1,5')).toBe('1.083333')
    expect(oreDecimali('1,75')).toBe('2.25')
  })
  it('il punto vale come la virgola', () => {
    expect(oreDecimali('1.30')).toBe('1.50')
  })
  it.each(['', 'abc', '1,', ',30', '1,2,3', '-1,30', '1;30'])('rifiuta %j', v => {
    expect(() => oreDecimali(v)).toThrow('Le ore si scrivono come ore,minuti (es. 1,30).')
  })
})
