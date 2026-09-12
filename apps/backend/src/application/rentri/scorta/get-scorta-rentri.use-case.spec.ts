import { GetScortaRentriUseCase } from './get-scorta-rentri.use-case'

describe('GetScortaRentriUseCase', () => {
  const TENANT = 'tenant-1'

  function build(overrides: {
    totale?: number
    perBlocco?: { codiceBlocco: string; numIscrSito: string; disponibili: number }[]
    elencaBlocchiImpl?: () => Promise<{
      blocchi: { codiceBlocco: string; descrizione: string | null }[]
    }>
  }) {
    const scortaRepo = {
      contaTotaleDisponibili: jest.fn().mockResolvedValue(overrides.totale ?? 0),
      contaDisponibiliPerBlocco: jest.fn().mockResolvedValue(overrides.perBlocco ?? []),
    }
    const elencaBlocchi = {
      execute: overrides.elencaBlocchiImpl ?? jest.fn().mockResolvedValue({ blocchi: [] }),
    }
    return {
      useCase: new GetScortaRentriUseCase(scortaRepo as any, elencaBlocchi as any),
      scortaRepo,
    }
  }

  it('somma i disponibili e arricchisce ogni blocco con la descrizione letta dall’ente', async () => {
    const { useCase, scortaRepo } = build({
      totale: 7,
      perBlocco: [
        { codiceBlocco: 'BLK-A', numIscrSito: 'OP1', disponibili: 5 },
        { codiceBlocco: 'BLK-B', numIscrSito: 'OP1', disponibili: 2 },
      ],
      elencaBlocchiImpl: jest.fn().mockResolvedValue({
        blocchi: [
          { codiceBlocco: 'BLK-A', descrizione: 'Blocco sede Roma' },
          { codiceBlocco: 'BLK-B', descrizione: 'Blocco riserva' },
        ],
      }),
    })

    const risultato = await useCase.execute(TENANT)

    expect(scortaRepo.contaTotaleDisponibili).toHaveBeenCalledWith(TENANT)
    expect(risultato).toEqual({
      totaleDisponibili: 7,
      perBlocco: [
        {
          codiceBlocco: 'BLK-A',
          numIscrSito: 'OP1',
          descrizione: 'Blocco sede Roma',
          disponibili: 5,
        },
        {
          codiceBlocco: 'BLK-B',
          numIscrSito: 'OP1',
          descrizione: 'Blocco riserva',
          disponibili: 2,
        },
      ],
    })
  })

  it('riporta la sede (numIscrSito) di ogni riga: il totale è di tenant ma ogni riga resta attribuibile alla sua sede', async () => {
    const { useCase } = build({
      totale: 10,
      perBlocco: [
        { codiceBlocco: 'BLK-A', numIscrSito: 'OP1-SEDE-A', disponibili: 0 },
        { codiceBlocco: 'BLK-B', numIscrSito: 'OP1-SEDE-B', disponibili: 10 },
      ],
    })

    const risultato = await useCase.execute(TENANT)

    expect(risultato.perBlocco.map(b => b.numIscrSito)).toEqual(['OP1-SEDE-A', 'OP1-SEDE-B'])
  })

  it('nessuna scorta: ritorna zero, mai un errore', async () => {
    const { useCase } = build({})

    const risultato = await useCase.execute(TENANT)

    expect(risultato).toEqual({ totaleDisponibili: 0, perBlocco: [] })
  })

  it('l’ente irraggiungibile per le descrizioni non fa fallire la lettura della scorta', async () => {
    const { useCase } = build({
      totale: 3,
      perBlocco: [{ codiceBlocco: 'BLK-A', numIscrSito: 'OP1', disponibili: 3 }],
      elencaBlocchiImpl: jest.fn().mockRejectedValue(new Error('RENTRI non raggiungibile')),
    })

    const risultato = await useCase.execute(TENANT)

    expect(risultato).toEqual({
      totaleDisponibili: 3,
      perBlocco: [{ codiceBlocco: 'BLK-A', numIscrSito: 'OP1', descrizione: null, disponibili: 3 }],
    })
  })
})
