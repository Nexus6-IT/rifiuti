import { FreschezzaProbe } from './freschezza.probe'

describe('FreschezzaProbe', () => {
  const probe = new FreschezzaProbe()

  it('valuta ok/warn/error solo dove esiste una cadenza attesa', async () => {
    const [voce] = probe.raccogli([
      {
        key: 'backup',
        label: 'Ultimo backup riuscito',
        ultimo: new Date(Date.now() - 5 * 24 * 3_600_000),
        descrizioneEvento: 'ultimo backup riuscito',
        cadenzaAttesaMs: 24 * 3_600_000,
      },
    ])

    expect(voce.key).toBe('freschezza.backup')
    expect(voce.state).toBe('error')
    expect(voce.detail).toContain('cadenza attesa 1 g')
  })

  it('mostra come info — non ok — un dato di dominio senza cadenza attesa', async () => {
    const [voce] = probe.raccogli([
      {
        key: 'ultimo-fir',
        label: 'Ultimo FIR emesso',
        ultimo: new Date(Date.now() - 3 * 24 * 3_600_000),
        descrizioneEvento: 'ultimo FIR emesso',
      },
    ])

    expect(voce.state).toBe('info')
    expect(voce.detail).toContain('ultimo FIR emesso 3 g fa')
    expect(voce.detail).toContain('non un giudizio')
  })

  it('dichiara unknown il dato mai prodotto, non ok', async () => {
    const [voce] = probe.raccogli([
      {
        key: 'ultimo-fir',
        label: 'Ultimo FIR emesso',
        ultimo: null,
        descrizioneEvento: 'ultimo FIR emesso',
      },
    ])

    expect(voce.state).toBe('unknown')
    expect(voce.since).toBeNull()
  })

  it('dichiara off la misura spenta di proposito, riportandone il motivo', async () => {
    const [voce] = probe.raccogli([
      {
        key: 'backup',
        label: 'Ultimo backup riuscito',
        ultimo: null,
        descrizioneEvento: 'ultimo backup riuscito',
        cadenzaAttesaMs: 24 * 3_600_000,
        spenta: { motivo: 'Nessuna pianificazione di backup attiva.' },
      },
    ])

    expect(voce.state).toBe('off')
    expect(voce.detail).toBe('Nessuna pianificazione di backup attiva.')
  })
})
