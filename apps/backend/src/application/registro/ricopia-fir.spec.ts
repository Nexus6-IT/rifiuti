import { Prisma } from '@prisma/client'
import { quantitaComeInDatabase, stessiDatiRicopia } from './ricopia-fir'

describe('ricopia-fir', () => {
  const base = {
    cerCode: '20 03 01',
    quantity: 100,
    unit: 'KG',
    movementDate: new Date('2026-03-01T00:00:00Z'),
  }

  it('quantitaComeInDatabase arrotonda a 2 decimali, metà per eccesso', () => {
    expect(quantitaComeInDatabase(1.005).toString()).toBe('1.01')
    expect(quantitaComeInDatabase('2.344').toString()).toBe('2.34')
  })

  it('stessiDatiRicopia arrotonda come numeric(10,2)', () => {
    expect(stessiDatiRicopia({ ...base, quantity: 1.005 }, { ...base, quantity: '1.01' })).toBe(
      true
    )
    expect(
      stessiDatiRicopia(
        { ...base, quantity: 100.005 },
        { ...base, quantity: new Prisma.Decimal('100.01') }
      )
    ).toBe(true)
    expect(stessiDatiRicopia({ ...base, quantity: 1.004 }, { ...base, quantity: '1.01' })).toBe(
      false
    )
  })

  it('CER con o senza spazi e asterisco, unità con alias: stessi dati', () => {
    expect(stessiDatiRicopia({ ...base, cerCode: '200301*', unit: 'kilogrammi' }, base)).toBe(true)
  })

  it('data o unità diverse: dati diversi', () => {
    expect(
      stessiDatiRicopia({ ...base, movementDate: new Date('2026-03-02T00:00:00Z') }, base)
    ).toBe(false)
    expect(stessiDatiRicopia({ ...base, unit: 'T' }, base)).toBe(false)
  })

  it('CER diverso: dati diversi', () => {
    expect(stessiDatiRicopia({ ...base, cerCode: '20 03 02' }, base)).toBe(false)
  })
})
