import { test, expect } from '@playwright/test'
import { decidiTeardown } from '../../utils/decisione-teardown'

/**
 * Self-test della decisione del globalTeardown (scripts/verifica-residuo.ts):
 * funzione pura, nessuna rete, nessun backend. La passata 1 della CI non ha
 * `/auth/dev/login` e non registra nulla: il teardown non deve tentare un
 * login. La passata 2 registra risorse e si autentica col dev-login: la
 * pulizia deve girare davvero. Se c'è qualcosa da pulire ma l'admin non è
 * autenticabile, è un errore, non un warning (prima passava in silenzio).
 */
test.describe('decidiTeardown', () => {
  test('niente registrato e nessun database: non fa nulla, con o senza admin autenticabile', () => {
    expect(
      decidiTeardown({ registrate: 0, adminAutenticabile: false, databaseDisponibile: false })
    ).toBe('niente')
    expect(
      decidiTeardown({ registrate: 0, adminAutenticabile: true, databaseDisponibile: false })
    ).toBe('niente')
  })

  test('niente registrato ma database disponibile: solo verifica di residuo, senza login', () => {
    expect(
      decidiTeardown({ registrate: 0, adminAutenticabile: false, databaseDisponibile: true })
    ).toBe('solo-verifica')
  })

  test('registrato qualcosa e admin autenticabile: procede con pulizia e verifica', () => {
    expect(
      decidiTeardown({ registrate: 3, adminAutenticabile: true, databaseDisponibile: true })
    ).toBe('procedi')
  })

  test('registrato qualcosa ma admin non autenticabile: errore esplicito', () => {
    expect(
      decidiTeardown({ registrate: 1, adminAutenticabile: false, databaseDisponibile: true })
    ).toBe('errore')
  })
})
