/**
 * RedisService — TDD tests per l'epoca di sessione (sessione singola per utente)
 */

import { RedisService } from './redis.service'

describe('RedisService — epoca di sessione', () => {
  function servizioConFinta() {
    const archivio = new Map<string, string>()
    const servizio = Object.create(RedisService.prototype) as RedisService
    ;(servizio as unknown as { client: unknown }).client = {
      set: async (chiave: string, valore: string) => {
        archivio.set(chiave, valore)
        return 'OK'
      },
      get: async (chiave: string) => archivio.get(chiave) ?? null,
    }
    return servizio
  }

  it("registra e rilegge l'epoca di sessione di un utente", async () => {
    const servizio = servizioConFinta()

    const epoca = await servizio.impostaEpocaSessione('utente-1')
    const riletta = await servizio.leggiEpocaSessione('utente-1')

    expect(typeof epoca).toBe('number')
    expect(riletta).toBe(epoca)
  })

  it('restituisce null per un utente senza epoca registrata', async () => {
    const servizio = servizioConFinta()

    expect(await servizio.leggiEpocaSessione('mai-visto')).toBeNull()
  })
})
