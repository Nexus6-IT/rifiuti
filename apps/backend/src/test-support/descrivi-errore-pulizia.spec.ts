import { descriviErrorePulizia } from './legami-di-test'

describe('descriviErrorePulizia', () => {
  it('non perde il messaggio Prisma che comincia con una riga vuota', () => {
    const e = new Error(
      '\nInvalid `prisma.$executeRawUnsafe()` invocation:\n\n\nRaw query failed. Code: `57014`.'
    )
    const r = descriviErrorePulizia(e)
    expect(r).toContain('Raw query failed')
    expect(r).toContain('57014')
    expect(r).not.toMatch(/\n/)
  })

  it('antepone il codice quando l errore ne ha uno', () => {
    const e = Object.assign(new Error('Transaction already closed'), { code: 'P2028' })
    expect(descriviErrorePulizia(e)).toBe('[P2028] Transaction already closed')
  })

  it('accorcia i messaggi lunghi tenendo inizio e fine', () => {
    const r = descriviErrorePulizia(new Error(`inizio ${'x'.repeat(2000)} fine`))
    expect(r.length).toBeLessThan(700)
    expect(r).toContain('inizio')
    expect(r).toContain('fine')
  })

  it('gestisce i valori che non sono Error', () => {
    expect(descriviErrorePulizia('boom')).toBe('boom')
  })
})
