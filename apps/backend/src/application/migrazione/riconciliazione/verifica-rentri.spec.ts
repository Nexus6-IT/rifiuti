import { LettoreRentri, verificaRentriSolaLettura } from './verifica-rentri'

/** Finto client RENTRI: ogni metodo che non sia la lettura lancia, cosi' una POST fa fallire il test. */
function clientFinto(risposte: Record<string, 'ok' | 404 | 500>) {
  const chiamate: string[] = []
  const base: LettoreRentri = {
    async dettaglioMovimentoPerIdentificativo(registro, movimento) {
      chiamate.push(`${registro}/${movimento}`)
      const r = risposte[movimento]
      if (r === 'ok') return { identificativo: movimento }
      throw Object.assign(new Error('rentri'), { status: r })
    },
  }
  const client = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return (target as never)[prop]
      return () => {
        throw new Error(`metodo vietato: ${String(prop)}`)
      }
    },
  }) as LettoreRentri & { inviaMovimenti: () => never }
  return { client, chiamate }
}

describe('verifica RENTRI in sola lettura', () => {
  it('classifica presente, assente (404) e non raggiungibile (altri errori), senza mai inviare', async () => {
    const { client, chiamate } = clientFinto({ A: 'ok', B: 404, C: 500 })
    const esiti = await verificaRentriSolaLettura(
      client,
      [
        { identificativo: 'A', registroRentri: 'REG-1' },
        { identificativo: 'B', registroRentri: 'REG-1' },
        { identificativo: 'C', registroRentri: 'REG-1' },
      ],
      { pausaMs: 0 }
    )
    expect(esiti).toEqual([
      { identificativo: 'A', esito: 'PRESENTE' },
      { identificativo: 'B', esito: 'ASSENTE' },
      { identificativo: 'C', esito: 'NON_RAGGIUNGIBILE' },
    ])
    expect(chiamate).toEqual(['REG-1/A', 'REG-1/B', 'REG-1/C'])
    // Nessuna POST: `inviaMovimenti` sul finto client lancia, e non e' stato toccato.
    expect(() => client.inviaMovimenti()).toThrow(/metodo vietato: inviaMovimenti/)
  })

  it('un registro senza identificativo RENTRI non si interroga ed e non raggiungibile', async () => {
    const { client, chiamate } = clientFinto({ A: 'ok' })
    const esiti = await verificaRentriSolaLettura(
      client,
      [{ identificativo: 'A', registroRentri: null }],
      { pausaMs: 0 }
    )
    expect(esiti[0].esito).toBe('NON_RAGGIUNGIBILE')
    expect(chiamate).toEqual([])
  })

  it('rispetta il massimo di identificativi', async () => {
    const { client, chiamate } = clientFinto({ A: 'ok', B: 'ok' })
    const esiti = await verificaRentriSolaLettura(
      client,
      [
        { identificativo: 'A', registroRentri: 'R' },
        { identificativo: 'B', registroRentri: 'R' },
      ],
      { pausaMs: 0, massimo: 1 }
    )
    expect(esiti).toHaveLength(1)
    expect(chiamate).toEqual(['R/A'])
  })
})
