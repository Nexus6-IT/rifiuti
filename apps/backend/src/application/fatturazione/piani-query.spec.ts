/**
 * conJoinLineari: il valore di `enable_nestloop` letto prima torna SEMPRE, anche quando la
 * funzione interna lancia un errore che il chiamante poi cattura restando nella transazione.
 */
import type { Prisma } from '@prisma/client'
import { conJoinLineari } from './piani-query'

/** Finto client di transazione: registra il valore di nestloop impostato con `set_config`. */
function fintoTx(opzioni: { setConfigFallisce?: boolean } = {}) {
  const impostazioni: string[] = []
  const tx = {
    $queryRaw: jest.fn((testo: TemplateStringsArray, ...valori: unknown[]) => {
      const sql = testo.join('?')
      if (sql.includes('current_setting')) return Promise.resolve([{ v: 'on' }])
      if (sql.includes('set_config')) {
        if (opzioni.setConfigFallisce) return Promise.reject(new Error('transazione abortita'))
        impostazioni.push(String(valori[0]))
      }
      return Promise.resolve([])
    }),
    $executeRaw: jest.fn().mockResolvedValue(0),
  }
  return { tx: tx as unknown as Prisma.TransactionClient, impostazioni }
}

describe('conJoinLineari', () => {
  it('a buon fine ripristina il valore letto prima e restituisce il risultato', async () => {
    const { tx, impostazioni } = fintoTx()
    await expect(conJoinLineari(tx, async () => 42)).resolves.toBe(42)
    expect(impostazioni).toEqual(['on'])
  })

  it('se la funzione lancia, ripristina comunque il valore e rilancia lo stesso errore', async () => {
    const { tx, impostazioni } = fintoTx()
    const errore = new Error('errore di dominio')
    await expect(
      conJoinLineari(tx, async () => {
        throw errore
      })
    ).rejects.toBe(errore)
    expect(impostazioni).toEqual(['on'])
  })

  it('se la funzione lancia e il ripristino fallisce (transazione abortita), l errore originale non si perde', async () => {
    const { tx } = fintoTx({ setConfigFallisce: true })
    const errore = new Error('errore originale')
    await expect(
      conJoinLineari(tx, async () => {
        throw errore
      })
    ).rejects.toBe(errore)
  })
})
