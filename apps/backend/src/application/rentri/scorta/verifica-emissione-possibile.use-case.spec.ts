import { VerificaEmissionePossibileRentriUseCase } from './verifica-emissione-possibile.use-case'

describe('VerificaEmissionePossibileRentriUseCase', () => {
  const TENANT = 'tenant-1'

  function build(overrides: {
    principale?: any
    disponibili?: number
    codiceFiscale?: string | null
    blocchiAttivi?: unknown[]
    unitaLocaliTenant?: unknown[]
    /** false = l'emissione non consuma scorta (MANUALE, senza certificato, modulo spento...). */
    scortaRichiesta?: boolean
  }) {
    const unitaLocaleService = {
      getPrincipale: jest.fn().mockResolvedValue(
        overrides.principale === undefined
          ? {
              numIscrSito: 'OP1234ABC123456-RM1234',
              denominazione: 'Sede principale',
              codiceBloccoPredefinito: 'BLK-A',
              dimensioneScortaDesiderata: null,
            }
          : overrides.principale
      ),
      listForTenant: jest.fn().mockResolvedValue(overrides.unitaLocaliTenant ?? []),
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
        vidimazioneClient as any,
        {
          perTenant: jest
            .fn()
            .mockResolvedValue(
              overrides.scortaRichiesta === false ? null : { numIscrSito: 'OP1234ABC123456-RM1234' }
            ),
        } as any
      ),
    }
  }

  it('numeri disponibili: emissione possibile, nessun motivo', async () => {
    const { useCase } = build({ disponibili: 4 })

    const risultato = await useCase.execute(TENANT)

    expect(risultato).toEqual({
      possibile: true,
      numeriDisponibili: 4,
      scortaRichiesta: true,
      inEsaurimento: false,
      soglia: null,
    })
  })

  it('nessuna unità locale configurata: impossibile, motivo esplicito', async () => {
    const { useCase } = build({ principale: null })

    const risultato = await useCase.execute(TENANT)

    expect(risultato.possibile).toBe(false)
    expect(risultato.numeriDisponibili).toBe(0)
    expect(risultato.motivo).toMatch(/unità locale/i)
  })

  it('unità locali esistenti ma nessuna marcata principale: motivo NON dice "nessuna configurata" (falso)', async () => {
    const { useCase } = build({
      principale: null,
      unitaLocaliTenant: [
        {
          numIscrSito: 'OP1234ABC123456-RM1234',
          denominazione: 'Sede A',
          codiceBloccoPredefinito: null,
        },
      ],
    })

    const risultato = await useCase.execute(TENANT)

    expect(risultato.possibile).toBe(false)
    expect(risultato.numeriDisponibili).toBe(0)
    expect(risultato.motivo).not.toMatch(/nessuna unità locale rentri configurata/i)
    expect(risultato.motivo).toMatch(/nessuna.*(è|sia).*(principale|predefinita)/i)
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

  describe('avvisi preventivi (Task 3 del piano scorta -> emissione)', () => {
    const conSoglia = (soglia: number | null) => ({
      numIscrSito: 'OP1234ABC123456-RM1234',
      denominazione: 'Sede principale',
      codiceBloccoPredefinito: 'BLK-A',
      dimensioneScortaDesiderata: soglia,
    })

    it('sotto la soglia configurata (ma non vuota): possibile, ma inEsaurimento', async () => {
      const { useCase } = build({ principale: conSoglia(10), disponibili: 3 })

      const r = await useCase.execute(TENANT)

      expect(r).toMatchObject({
        possibile: true,
        numeriDisponibili: 3,
        inEsaurimento: true,
        soglia: 10,
        scortaRichiesta: true,
      })
    })

    it('alla soglia o sopra: non in esaurimento', async () => {
      const { useCase } = build({ principale: conSoglia(10), disponibili: 10 })
      expect(await useCase.execute(TENANT)).toMatchObject({ inEsaurimento: false, soglia: 10 })
    })

    it('nessuna soglia configurata: mai "in esaurimento" (nessuna soglia inventata)', async () => {
      const { useCase } = build({ principale: conSoglia(null), disponibili: 1 })
      expect(await useCase.execute(TENANT)).toMatchObject({ inEsaurimento: false, soglia: null })
    })

    it('scorta vuota: impossibile, non "in esaurimento" (e un altro caso: scorta esaurita)', async () => {
      const { useCase } = build({ principale: conSoglia(10), disponibili: 0 })
      const r = await useCase.execute(TENANT)
      expect(r.possibile).toBe(false)
      expect(r.inEsaurimento).toBe(false)
      expect(r.scortaRichiesta).toBe(true)
    })

    it('l emissione non consuma scorta (es. MANUALE): scortaRichiesta false, anche con la scorta vuota', async () => {
      const { useCase } = build({
        principale: conSoglia(10),
        disponibili: 0,
        scortaRichiesta: false,
      })
      const r = await useCase.execute(TENANT)
      expect(r.scortaRichiesta).toBe(false)
    })
  })
})
