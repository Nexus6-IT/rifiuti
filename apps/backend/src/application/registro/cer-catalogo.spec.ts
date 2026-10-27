import { cerCodeExists, cerNelCatalogo, normalizzaCerCode } from './cer-catalogo'

describe('cer-catalogo', () => {
  it('normalizzaCerCode porta ogni formato di 6 cifre a "NN NN NN" e conserva l\'asterisco', () => {
    expect(normalizzaCerCode('200301')).toBe('20 03 01')
    expect(normalizzaCerCode('13.02.05*')).toBe('13 02 05*')
    expect(normalizzaCerCode('')).toBe('')
  })

  it('cerCodeExists cerca sia la forma con sia quella senza asterisco', async () => {
    const count = jest.fn().mockResolvedValue(1)
    const db = { cERCode: { count, findMany: jest.fn() } }
    await expect(cerCodeExists(db, '13 02 05*')).resolves.toBe(true)
    expect(count).toHaveBeenCalledWith({ where: { code: { in: ['13 02 05', '13 02 05*'] } } })
  })

  it('cerNelCatalogo restituisce la forma del catalogo, con l\'asterisco se il catalogo lo ha', async () => {
    const findMany = jest.fn().mockResolvedValue([{ code: '13 02 05*' }])
    const db = { cERCode: { count: jest.fn(), findMany } }
    await expect(cerNelCatalogo(db, '130205')).resolves.toBe('13 02 05*')
  })

  it('cerNelCatalogo restituisce null se il CER non esiste', async () => {
    const db = { cERCode: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) } }
    await expect(cerNelCatalogo(db, '999999')).resolves.toBeNull()
  })
})
