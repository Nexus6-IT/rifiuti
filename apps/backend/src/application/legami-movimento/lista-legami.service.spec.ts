import { BadRequestException } from '@nestjs/common'
import { DIMENSIONE_PREDEFINITA, MAX_DIMENSIONE, normalizzaFiltri } from './lista-legami.service'

describe('normalizzaFiltri (lista «da collegare»)', () => {
  it('predefiniti: pagina 1, 50 righe, stati visibili senza ESCLUSO', () => {
    const f = normalizzaFiltri(undefined)
    expect(f.pagina).toBe(1)
    expect(f.dimensione).toBe(DIMENSIONE_PREDEFINITA)
    expect(f.stati).toEqual(['MANCANTE', 'DA_RIALLINEARE', 'DA_COLLEGARE', 'PROPOSTO'])
  })

  it('esclusi true aggiunge ESCLUSO; chiedere ESCLUSO equivale a chiederlo', () => {
    expect(normalizzaFiltri({ esclusi: true }).stati).toContain('ESCLUSO')
    expect(normalizzaFiltri({ stati: ['ESCLUSO'] }).stati).toEqual(['ESCLUSO'])
  })

  it('stati che la lista non mostra (CONFERMATO, FATTURATO) danno un insieme vuoto', () => {
    expect(normalizzaFiltri({ stati: ['CONFERMATO', 'FATTURATO'] }).stati).toEqual([])
  })

  it('il tetto della pagina e’ 200', () => {
    expect(normalizzaFiltri({ dimensione: MAX_DIMENSIONE }).dimensione).toBe(200)
    expect(() => normalizzaFiltri({ dimensione: 201 })).toThrow(BadRequestException)
  })

  it('rifiuta valori non validi', () => {
    for (const f of [
      { pagina: 0 },
      { dimensione: 0 },
      { clienteId: 'x' },
      { dal: '2026-02-30' },
      { dal: '2026-02-02', al: '2026-02-01' },
      { motivo: 'BOH' as never },
      { stati: ['BOH' as never] },
    ]) {
      expect(() => normalizzaFiltri(f)).toThrow(BadRequestException)
    }
  })

  it('accetta i valori della query string: numeri come testo, esclusi "true", stato singolo, stati separati da virgole', () => {
    const f = normalizzaFiltri({
      pagina: '2' as never,
      dimensione: '50' as never,
      esclusi: 'true' as never,
      stato: 'PROPOSTO',
    })
    expect(f.pagina).toBe(2)
    expect(f.dimensione).toBe(50)
    expect(f.stati).toEqual(['PROPOSTO'])
    expect(normalizzaFiltri({ stati: 'MANCANTE,ESCLUSO' as never }).stati).toEqual([
      'MANCANTE',
      'ESCLUSO',
    ])
    expect(() => normalizzaFiltri({ dimensione: '5x' as never })).toThrow(BadRequestException)
  })
})
