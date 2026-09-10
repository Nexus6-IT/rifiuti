import {
  DatoMancantePerRentriError,
  RisolutoreComune,
  mappaDestinatario,
  mappaProduttore,
  mappaTrasportatore,
} from './mappa-parti'

/** Risolutore di comune finto: risolve solo i comuni presenti nella mappa fornita. */
function creaRisolutoreComune(mappa: Record<string, string>): RisolutoreComune {
  return {
    async risolvi(nomeComune: string, provinciaSigla: string): Promise<string | null> {
      const chiave = `${nomeComune}|${provinciaSigla}`
      return mappa[chiave] ?? null
    },
  }
}

describe('mappaProduttore', () => {
  it('mappa correttamente denominazione, codice_fiscale e indirizzo con comune risolto', async () => {
    const risolutore = creaRisolutoreComune({ 'Milano|MI': '015146' })

    const risultato = await mappaProduttore(
      {
        ragioneSociale: 'Acme S.r.l.',
        partitaIVA: '12345678901',
        indirizzo: {
          via: 'Via Roma',
          civico: '10',
          cap: '20100',
          comune: 'Milano',
          provincia: 'MI',
        },
      },
      risolutore
    )

    expect(risultato).toEqual({
      denominazione: 'Acme S.r.l.',
      codice_fiscale: '12345678901',
      indirizzo: {
        citta: { comune_id: '015146' },
        indirizzo: 'Via Roma',
        civico: '10',
        cap: '20100',
      },
    })
  })

  it('lancia DatoMancantePerRentriError se manca un campo obbligatorio (ragioneSociale)', async () => {
    const risolutore = creaRisolutoreComune({ 'Milano|MI': '015146' })

    await expect(
      mappaProduttore(
        {
          ragioneSociale: '',
          partitaIVA: '12345678901',
          indirizzo: {
            via: 'Via Roma',
            civico: '10',
            cap: '20100',
            comune: 'Milano',
            provincia: 'MI',
          },
        },
        risolutore
      )
    ).rejects.toThrow(DatoMancantePerRentriError)
  })

  it('lancia DatoMancantePerRentriError se il comune non si risolve nel catalogo RENTRI', async () => {
    const risolutore = creaRisolutoreComune({})

    await expect(
      mappaProduttore(
        {
          ragioneSociale: 'Acme S.r.l.',
          partitaIVA: '12345678901',
          indirizzo: {
            via: 'Via Roma',
            civico: '10',
            cap: '20100',
            comune: 'Comune Inesistente',
            provincia: 'MI',
          },
        },
        risolutore
      )
    ).rejects.toThrow(DatoMancantePerRentriError)
  })
})

describe('mappaDestinatario', () => {
  it('mappa correttamente denominazione, codice_fiscale e indirizzo con comune risolto', async () => {
    const risolutore = creaRisolutoreComune({ 'Torino|TO': '001272' })

    const risultato = await mappaDestinatario(
      {
        ragioneSociale: 'Impianto Beta S.p.A.',
        partitaIVA: '98765432109',
        indirizzo: {
          via: 'Corso Francia',
          civico: '5',
          cap: '10100',
          comune: 'Torino',
          provincia: 'TO',
        },
      },
      risolutore
    )

    expect(risultato).toEqual({
      denominazione: 'Impianto Beta S.p.A.',
      codice_fiscale: '98765432109',
      indirizzo: {
        citta: { comune_id: '001272' },
        indirizzo: 'Corso Francia',
        civico: '5',
        cap: '10100',
      },
    })
  })

  it('lancia DatoMancantePerRentriError se manca un campo obbligatorio (partitaIVA)', async () => {
    const risolutore = creaRisolutoreComune({ 'Torino|TO': '001272' })

    await expect(
      mappaDestinatario(
        {
          ragioneSociale: 'Impianto Beta S.p.A.',
          partitaIVA: '',
          indirizzo: {
            via: 'Corso Francia',
            civico: '5',
            cap: '10100',
            comune: 'Torino',
            provincia: 'TO',
          },
        },
        risolutore
      )
    ).rejects.toThrow(DatoMancantePerRentriError)
  })

  it('lancia DatoMancantePerRentriError se il comune non si risolve nel catalogo RENTRI', async () => {
    const risolutore = creaRisolutoreComune({})

    await expect(
      mappaDestinatario(
        {
          ragioneSociale: 'Impianto Beta S.p.A.',
          partitaIVA: '98765432109',
          indirizzo: {
            via: 'Corso Francia',
            civico: '5',
            cap: '10100',
            comune: 'Comune Sconosciuto',
            provincia: 'TO',
          },
        },
        risolutore
      )
    ).rejects.toThrow(DatoMancantePerRentriError)
  })
})

describe('mappaTrasportatore', () => {
  it('mappa correttamente denominazione, codice_fiscale e tipo_trasporto', () => {
    const risultato = mappaTrasportatore(
      {
        ragioneSociale: 'Trasporti Gamma S.n.c.',
        partitaIVA: '11122233344',
      },
      'Terrestre'
    )

    expect(risultato).toEqual({
      denominazione: 'Trasporti Gamma S.n.c.',
      codice_fiscale: '11122233344',
      tipo_trasporto: 'Terrestre',
    })
  })

  it('include numero_iscrizione_albo quando presente e con formato valido', () => {
    const risultato = mappaTrasportatore(
      {
        ragioneSociale: 'Trasporti Gamma S.n.c.',
        partitaIVA: '11122233344',
        numeroIscrizione: 'AB/123456',
      },
      'Terrestre'
    )

    expect(risultato.numero_iscrizione_albo).toBe('AB/123456')
  })

  it('lancia DatoMancantePerRentriError se numero_iscrizione_albo ha un formato non valido', () => {
    expect(() =>
      mappaTrasportatore(
        {
          ragioneSociale: 'Trasporti Gamma S.n.c.',
          partitaIVA: '11122233344',
          numeroIscrizione: 'formato-non-valido',
        },
        'Terrestre'
      )
    ).toThrow(DatoMancantePerRentriError)
  })

  it('lancia DatoMancantePerRentriError se manca tipo_trasporto', () => {
    expect(() =>
      mappaTrasportatore(
        {
          ragioneSociale: 'Trasporti Gamma S.n.c.',
          partitaIVA: '11122233344',
        },
        undefined
      )
    ).toThrow(DatoMancantePerRentriError)
  })

  it('lancia DatoMancantePerRentriError se manca un campo obbligatorio (ragioneSociale)', () => {
    expect(() =>
      mappaTrasportatore(
        {
          ragioneSociale: '',
          partitaIVA: '11122233344',
        },
        'Terrestre'
      )
    ).toThrow(DatoMancantePerRentriError)
  })
})
