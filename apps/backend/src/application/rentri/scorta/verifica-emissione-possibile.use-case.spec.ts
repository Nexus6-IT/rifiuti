import { VerificaEmissionePossibileRentriUseCase } from './verifica-emissione-possibile.use-case'

describe('VerificaEmissionePossibileRentriUseCase', () => {
  const TENANT = 'tenant-1'

  function build(overrides: {
    principale?: any
    disponibili?: number
    codiceFiscale?: string | null
    blocchiAttivi?: unknown[]
  }) {
    const unitaLocaleService = {
      getPrincipale: jest.fn().mockResolvedValue(
        overrides.principale === undefined
          ? {
              numIscrSito: 'OP1234ABC123456-RM1234',
              denominazione: 'Sede principale',
              codiceBloccoPredefinito: 'BLK-A',
            }
          : overrides.principale
      ),
      listForTenant: jest.fn().mockResolvedValue([]),
    }
    const scortaRepo = {
      contaTotaleDisponibili: jest.fn().mockResolvedValue(overrides.disponibili ?? 0),
    }
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          codiceFiscale:
            overrides.codiceFiscale === undefined ? 'RSSMRA80A01H501U' : overrides.codiceFiscale,
        }),
      },
    }
    const vidimazioneClient = {
      elencaBlocchi: jest.fn().mockResolvedValue({
        risultati: overrides.blocchiAttivi ?? [],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 0 },
      }),
    }
    return {
      useCase: new VerificaEmissionePossibileRentriUseCase(
        prisma as any,
        unitaLocaleService as any,
        scortaRepo as any,
        vidimazioneClient as any
      ),
    }
  }

  it('numeri disponibili: emissione possibile, nessun motivo', async () => {
    const { useCase } = build({ disponibili: 4 })

    const risultato = await useCase.execute(TENANT)

    expect(risultato).toEqual({ possibile: true, numeriDisponibili: 4 })
  })

  it('nessuna unità locale configurata: impossibile, motivo esplicito', async () => {
    const { useCase } = build({ principale: null })

    const risultato = await useCase.execute(TENANT)

    expect(risultato.possibile).toBe(false)
    expect(risultato.numeriDisponibili).toBe(0)
    expect(risultato.motivo).toMatch(/unità locale/i)
  })

  it('scorta vuota e nessun blocco attivo presso l’ente: motivo "va creato sul portale RENTRI"', async () => {
    const { useCase } = build({
      disponibili: 0,
      principale: {
        numIscrSito: 'OP1234ABC123456-RM1234',
        denominazione: 'Sede principale',
        codiceBloccoPredefinito: null,
      },
      blocchiAttivi: [],
    })

    const risultato = await useCase.execute(TENANT)

    expect(risultato.possibile).toBe(false)
    expect(risultato.motivo).toMatch(/portale RENTRI/i)
  })

  it('scorta vuota ma un blocco predefinito già configurato: motivo generico "vidima un lotto"', async () => {
    const { useCase } = build({ disponibili: 0 })

    const risultato = await useCase.execute(TENANT)

    expect(risultato.possibile).toBe(false)
    expect(risultato.motivo).toMatch(/vidima un lotto/i)
  })
})
