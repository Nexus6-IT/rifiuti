import { mapConLimite } from './map-con-limite'

describe('mapConLimite', () => {
  it('mantiene l ordine dei risultati e non supera il limite', async () => {
    let inCorso = 0
    let massimo = 0
    const risultati = await mapConLimite([5, 4, 3, 2, 1, 0, 7, 8, 9], 4, async n => {
      inCorso++
      massimo = Math.max(massimo, inCorso)
      await new Promise(r => setTimeout(r, n))
      inCorso--
      return n * 2
    })
    expect(risultati).toEqual([10, 8, 6, 4, 2, 0, 14, 16, 18])
    expect(massimo).toBe(4)
  })

  it('elenco vuoto e limite maggiore degli elementi', async () => {
    expect(await mapConLimite([], 4, async n => n)).toEqual([])
    expect(await mapConLimite([1, 2], 4, async n => n + 1)).toEqual([2, 3])
  })

  it.each([NaN, 2.7, 0, -3])(
    'limite non valido (%s): elabora tutti gli elementi in ordine',
    async limite => {
      const risultati = await mapConLimite([1, 2, 3, 4], limite, async n => n * 10)
      expect(risultati).toEqual([10, 20, 30, 40])
    }
  )

  it('propaga il primo errore', async () => {
    await expect(
      mapConLimite([1, 2, 3], 2, async n => {
        if (n === 2) throw new Error('boom')
        return n
      })
    ).rejects.toThrow('boom')
  })
})
