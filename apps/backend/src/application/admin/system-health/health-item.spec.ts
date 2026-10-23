import { formattaDurata, valutaRitardo, SOGLIA_RITARDO_ERROR } from './health-item'

describe('formattaDurata', () => {
  it('usa i secondi sotto il minuto', () => {
    expect(formattaDurata(45_000)).toBe('45 s')
  })

  it('usa i minuti sotto l ora', () => {
    expect(formattaDurata(45 * 60_000)).toBe('45 min')
  })

  it('usa ore e minuti sotto il giorno', () => {
    expect(formattaDurata(3 * 3_600_000 + 12 * 60_000)).toBe('3 h 12 min')
  })

  it('omette i minuti quando sono zero', () => {
    expect(formattaDurata(3 * 3_600_000)).toBe('3 h')
  })

  it('usa giorni e ore oltre le 24 ore', () => {
    expect(formattaDurata(2 * 86_400_000 + 4 * 3_600_000)).toBe('2 g 4 h')
  })

  it('non inventa un numero quando la durata non ha senso', () => {
    expect(formattaDurata(Number.NaN)).toBe('n/d')
    expect(formattaDurata(-1)).toBe('n/d')
  })
})

describe('valutaRitardo', () => {
  const adesso = new Date('2026-09-01T12:00:00.000Z')
  const cadenzaSeiOre = 6 * 3_600_000

  it('dichiara unknown — non ok — quando non esiste alcun evento registrato', () => {
    const esito = valutaRitardo({ ultimo: null, cadenzaAttesaMs: cadenzaSeiOre, adesso })

    expect(esito.state).toBe('unknown')
    expect(esito.since).toBeNull()
    expect(esito.ritardoMs).toBeNull()
    expect(esito.detail).toContain('non misurabile')
  })

  it('e ok entro la cadenza attesa', () => {
    const esito = valutaRitardo({
      ultimo: new Date(adesso.getTime() - 2 * 3_600_000),
      cadenzaAttesaMs: cadenzaSeiOre,
      adesso,
    })

    expect(esito.state).toBe('ok')
    expect(esito.since).toBe(new Date(adesso.getTime() - 2 * 3_600_000).toISOString())
  })

  it('resta ok fino alla soglia di warn (una corsa in ritardo di poco non e un allarme)', () => {
    const esito = valutaRitardo({
      ultimo: new Date(adesso.getTime() - 1.4 * cadenzaSeiOre),
      cadenzaAttesaMs: cadenzaSeiOre,
      adesso,
    })

    expect(esito.state).toBe('ok')
  })

  it('passa a warn quando una corsa risulta saltata', () => {
    const esito = valutaRitardo({
      ultimo: new Date(adesso.getTime() - 2 * cadenzaSeiOre),
      cadenzaAttesaMs: cadenzaSeiOre,
      adesso,
    })

    expect(esito.state).toBe('warn')
  })

  it('passa a error oltre la soglia grave', () => {
    const esito = valutaRitardo({
      ultimo: new Date(adesso.getTime() - (SOGLIA_RITARDO_ERROR + 1) * cadenzaSeiOre),
      cadenzaAttesaMs: cadenzaSeiOre,
      adesso,
    })

    expect(esito.state).toBe('error')
  })

  it('mette nella prova il tempo trascorso e la cadenza attesa, non un aggettivo', () => {
    const esito = valutaRitardo({
      ultimo: new Date(adesso.getTime() - 3 * 3_600_000),
      cadenzaAttesaMs: cadenzaSeiOre,
      adesso,
      descrizioneEvento: 'ultima riconciliazione',
    })

    expect(esito.detail).toBe('ultima riconciliazione 3 h fa (cadenza attesa 6 h).')
  })
})
