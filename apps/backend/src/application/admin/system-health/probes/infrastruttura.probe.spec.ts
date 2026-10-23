import { InfrastrutturaProbe, TIMEOUT_CONTROLLO_MS } from './infrastruttura.probe'

describe('InfrastrutturaProbe', () => {
  const probe = new InfrastrutturaProbe()

  it('dichiara ok con la prova del contatto e il tempo di risposta', async () => {
    const [voce] = await probe.raccogli([
      {
        key: 'postgres',
        label: 'Banca dati PostgreSQL',
        configurato: true,
        verifica: async () => 'SELECT 1 eseguita',
      },
    ])

    expect(voce.key).toBe('infra.postgres')
    expect(voce.state).toBe('ok')
    expect(voce.detail).toMatch(/^SELECT 1 eseguita \(\d+ ms\)\.$/)
    expect(voce.since).not.toBeNull()
  })

  it('dichiara off — non error — la dipendenza non configurata in questo ambiente', async () => {
    const verifica = jest.fn()

    const [voce] = await probe.raccogli([
      {
        key: 'smtp',
        label: 'Invio email (SMTP)',
        configurato: false,
        motivoNonConfigurato: 'SMTP_HOST non valorizzato.',
        verifica,
      },
    ])

    expect(voce.state).toBe('off')
    expect(voce.detail).toBe('SMTP_HOST non valorizzato.')
    // Una dipendenza spenta di proposito non va nemmeno contattata.
    expect(verifica).not.toHaveBeenCalled()
  })

  it('dichiara error riportando il messaggio reale del guasto', async () => {
    const [voce] = await probe.raccogli([
      {
        key: 'redis',
        label: 'Redis',
        configurato: true,
        verifica: async () => {
          throw new Error('ECONNREFUSED 127.0.0.1:6379')
        },
      },
    ])

    expect(voce.state).toBe('error')
    expect(voce.detail).toContain('ECONNREFUSED 127.0.0.1:6379')
  })

  it('non resta appesa su una dipendenza che non risponde: il timeout e la risposta', async () => {
    jest.useFakeTimers()
    try {
      const raccolta = probe.raccogli([
        {
          key: 'keycloak',
          label: 'Keycloak',
          configurato: true,
          verifica: () => new Promise<string>(() => undefined),
        },
      ])

      await jest.advanceTimersByTimeAsync(TIMEOUT_CONTROLLO_MS + 1)
      const [voce] = await raccolta

      expect(voce.state).toBe('error')
      expect(voce.detail).toContain(`nessuna risposta entro ${TIMEOUT_CONTROLLO_MS} ms`)
    } finally {
      jest.useRealTimers()
    }
  })

  it('un controllo lento non impedisce agli altri di rispondere', async () => {
    const voci = await probe.raccogli([
      { key: 'a', label: 'A', configurato: true, verifica: async () => 'ok A' },
      {
        key: 'b',
        label: 'B',
        configurato: true,
        verifica: async () => {
          throw new Error('giu')
        },
      },
    ])

    expect(voci.map(v => v.state)).toEqual(['ok', 'error'])
  })
})
