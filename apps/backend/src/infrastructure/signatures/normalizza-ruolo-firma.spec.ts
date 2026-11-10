import { normalizzaRuoloFirma } from './signature-fir.repository'

describe('normalizzaRuoloFirma', () => {
  it.each([
    ['PRODUTTORE', 'PRODUCER'],
    ['TRASPORTATORE', 'CARRIER'],
    ['DESTINATARIO', 'RECEIVER'],
    ['PRODUCER', 'PRODUCER'],
    ['CARRIER', 'CARRIER'],
    ['RECEIVER', 'RECEIVER'],
  ])('%s diventa %s', (ingresso, atteso) => {
    expect(normalizzaRuoloFirma(ingresso)).toBe(atteso)
  })
})
