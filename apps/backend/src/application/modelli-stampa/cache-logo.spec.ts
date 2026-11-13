import { CacheLogo } from './cache-logo'

const T1 = '11111111-1111-1111-1111-111111111111'
const T2 = '22222222-2222-2222-2222-222222222222'
const M = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

describe('CacheLogo', () => {
  let ora = 0
  const nuova = (o: Partial<ConstructorParameters<typeof CacheLogo>[0]> = {}) =>
    new CacheLogo({ maxVoci: 10, maxCaratteri: 1000, ttlMs: 1000, adesso: () => ora, ...o })
  beforeEach(() => {
    ora = 0
  })

  it('non in cache = undefined; dopo set torna il logo; null e` un valore valido', () => {
    const c = nuova()
    expect(c.get(T1, M, 1)).toBeUndefined()
    c.set(T1, M, 1, 'LOGO')
    expect(c.get(T1, M, 1)).toBe('LOGO')
    c.set(T1, 'altro', 1, null)
    expect(c.get(T1, 'altro', 1)).toBeNull()
  })

  it('due aziende: mai il logo dell altra, nemmeno con lo stesso id modello', () => {
    const c = nuova()
    c.set(T1, M, 1, 'LOGO-AZIENDA-1')
    expect(c.get(T2, M, 1)).toBeUndefined()
    c.set(T2, M, 1, 'LOGO-AZIENDA-2')
    expect(c.get(T1, M, 1)).toBe('LOGO-AZIENDA-1')
    expect(c.get(T2, M, 1)).toBe('LOGO-AZIENDA-2')
    c.invalida(T1, M)
    expect(c.get(T1, M, 1)).toBeUndefined()
    expect(c.get(T2, M, 1)).toBe('LOGO-AZIENDA-2')
  })

  it('una versione nuova non trova la voce della vecchia (modifica del logo)', () => {
    const c = nuova()
    c.set(T1, M, 1, 'VECCHIO')
    expect(c.get(T1, M, 2)).toBeUndefined()
  })

  it('invalida toglie tutte le versioni del modello e libera lo spazio', () => {
    const c = nuova()
    c.set(T1, M, 1, 'A')
    c.set(T1, M, 2, 'B')
    c.invalida(T1, M)
    expect(c.dimensione).toBe(0)
  })

  it('il TTL fa scadere la voce', () => {
    const c = nuova({ ttlMs: 1000 })
    c.set(T1, M, 1, 'LOGO')
    ora = 999
    expect(c.get(T1, M, 1)).toBe('LOGO')
    ora = 1000
    expect(c.get(T1, M, 1)).toBeUndefined()
    expect(c.dimensione).toBe(0)
  })

  it('tetto sul numero di voci: si espelle la meno usata di recente', () => {
    const c = nuova({ maxVoci: 2 })
    c.set(T1, 'a', 1, 'A')
    c.set(T1, 'b', 1, 'B')
    c.get(T1, 'a', 1) // a e` usata: b diventa la piu' vecchia
    c.set(T1, 'c', 1, 'C')
    expect(c.get(T1, 'b', 1)).toBeUndefined()
    expect(c.get(T1, 'a', 1)).toBe('A')
    expect(c.get(T1, 'c', 1)).toBe('C')
  })

  it('tetto sui caratteri totali; un logo da solo oltre il tetto non si tiene', () => {
    const c = nuova({ maxCaratteri: 10 })
    c.set(T1, 'a', 1, 'x'.repeat(6))
    c.set(T1, 'b', 1, 'y'.repeat(6))
    expect(c.get(T1, 'a', 1)).toBeUndefined()
    expect(c.get(T1, 'b', 1)).toBe('y'.repeat(6))
    c.set(T1, 'enorme', 1, 'z'.repeat(11))
    expect(c.get(T1, 'enorme', 1)).toBeUndefined()
    expect(c.dimensione).toBe(1)
  })

  it('riscrivere la stessa chiave non gonfia il conteggio', () => {
    const c = nuova({ maxCaratteri: 10 })
    c.set(T1, M, 1, 'x'.repeat(6))
    c.set(T1, M, 1, 'y'.repeat(6))
    expect(c.get(T1, M, 1)).toBe('y'.repeat(6))
    expect(c.dimensione).toBe(1)
  })
})
