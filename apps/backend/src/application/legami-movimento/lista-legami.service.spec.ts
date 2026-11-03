import { BadRequestException } from '@nestjs/common'
import { MAX_PER_PAGINA, normalizzaFiltri, PER_PAGINA_PREDEFINITO } from './lista-legami.service'

describe('normalizzaFiltri (lista «da collegare»)', () => {
  it('predefiniti: pagina 1, 50 righe, stati visibili senza ESCLUSO', () => {
    const f = normalizzaFiltri(undefined)
    expect(f.pagina).toBe(1)
    expect(f.perPagina).toBe(PER_PAGINA_PREDEFINITO)
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
    expect(normalizzaFiltri({ perPagina: MAX_PER_PAGINA }).perPagina).toBe(200)
    expect(() => normalizzaFiltri({ perPagina: 201 })).toThrow(BadRequestException)
  })

  it('rifiuta valori non validi', () => {
    for (const f of [
      { pagina: 0 },
      { perPagina: 0 },
      { clienteId: 'x' },
      { dal: '2026-02-30' },
      { dal: '2026-02-02', al: '2026-02-01' },
      { motivo: 'BOH' as never },
      { stati: ['BOH' as never] },
    ]) {
      expect(() => normalizzaFiltri(f)).toThrow(BadRequestException)
    }
  })
})
