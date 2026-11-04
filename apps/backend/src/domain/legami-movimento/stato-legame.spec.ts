import {
  MOTIVO_ESCLUSIONE_CAUSALE,
  MOTIVO_ESCLUSIONE_DATA,
  STATI_LEGAME,
  type StatoLegame,
} from './codici'
import {
  esitoCorrezione,
  puoAggiornarePrezzi,
  statoDaProposta,
  statoDopoRicalcolo,
  transizioneEscludi,
  type InputCorrezione,
} from './stato-legame'

const base = (o: Partial<InputCorrezione> = {}): InputCorrezione => ({
  statoPrima: 'PROPOSTO',
  tipo: 'RETTIFICA',
  causaleFatturabileDopo: true,
  cerCambiato: false,
  dataDopo: '2026-11-10',
  dataPrima: '2026-11-10',
  fatturazioneDa: '2026-01-01',
  motivoEsclusionePrima: null,
  haQuantitaManuali: false,
  quantitaCambiata: false,
  ...o,
})

describe('statoDaProposta', () => {
  it('con motivi: DA_COLLEGARE, anche se la conferma e richiesta', () => {
    expect(
      statoDaProposta({ motivi: ['SENZA_PREZZO'], confermaRichiesta: true, completo: true })
    ).toBe('DA_COLLEGARE')
  })
  it('incompleta senza motivi: DA_COLLEGARE', () => {
    expect(statoDaProposta({ motivi: [], confermaRichiesta: false, completo: false })).toBe(
      'DA_COLLEGARE'
    )
  })
  it('completa: PROPOSTO, o CONFERMATO se l utente conferma', () => {
    expect(statoDaProposta({ motivi: [], confermaRichiesta: false, completo: true })).toBe(
      'PROPOSTO'
    )
    expect(statoDaProposta({ motivi: [], confermaRichiesta: true, completo: true })).toBe(
      'CONFERMATO'
    )
  })
})

describe('esitoCorrezione (tabella 7.5)', () => {
  it('rettifica non fatturato, stesso CER, causale fatturabile: stato invariato, nessun ricalcolo di prezzo', () => {
    for (const statoPrima of ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO'] as const) {
      const e = esitoCorrezione(base({ statoPrima }))
      expect(e).toEqual({
        statoDopo: statoPrima,
        ricalcolaProposta: false,
        ricontrollaValidita: false,
        ricalcolaQuantitaDaMovimento: true,
        aggiornaVigente: true,
        aggiornaData: true,
        scostamento: false,
        avvisiDaAggiungere: [],
        motivoEsclusione: null,
      })
    }
  })
  it('rettifica della sola data: si ricontrolla la validita, senza rifare la proposta', () => {
    const e = esitoCorrezione(base({ dataDopo: '2026-12-01' }))
    expect(e.statoDopo).toBe('PROPOSTO')
    expect(e.ricontrollaValidita).toBe(true)
    expect(e.ricalcolaProposta).toBe(false)
    expect(e.aggiornaVigente && e.aggiornaData).toBe(true)
  })
  it('rettifica che cambia il CER: CONFERMATO torna PROPOSTO, ricalcolo e avviso', () => {
    const e = esitoCorrezione(base({ statoPrima: 'CONFERMATO', cerCambiato: true }))
    expect(e.statoDopo).toBe('PROPOSTO')
    expect(e.ricalcolaProposta).toBe(true)
    expect(e.ricalcolaQuantitaDaMovimento).toBe(true)
    expect(e.avvisiDaAggiungere).toEqual(['CAMBIO_CER_DA_CONFERMARE'])
    expect(e.motivoEsclusione).toBeNull()
  })
  it('CER cambiato su PROPOSTO e DA_COLLEGARE: restano tali, ricalcolo e avviso', () => {
    for (const statoPrima of ['PROPOSTO', 'DA_COLLEGARE'] as const) {
      const e = esitoCorrezione(base({ statoPrima, cerCambiato: true }))
      expect(e.statoDopo).toBe(statoPrima)
      expect(e.ricalcolaProposta).toBe(true)
      expect(e.avvisiDaAggiungere).toEqual(['CAMBIO_CER_DA_CONFERMARE'])
    }
  })
  it('causale diventa non fatturabile: ESCLUSO con MOTIVO_ESCLUSIONE_CAUSALE', () => {
    for (const statoPrima of ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO'] as const) {
      const e = esitoCorrezione(base({ statoPrima, causaleFatturabileDopo: false }))
      expect(e.statoDopo).toBe('ESCLUSO')
      expect(e.motivoEsclusione).toBe(MOTIVO_ESCLUSIONE_CAUSALE)
      expect(e.ricalcolaProposta).toBe(false)
      expect(e.ricalcolaQuantitaDaMovimento).toBe(false)
      expect(e.aggiornaVigente && e.aggiornaData).toBe(true)
    }
  })
  it('ESCLUSO + causale diventa fatturabile: DA_COLLEGARE e ricalcolaProposta', () => {
    const e = esitoCorrezione(
      base({ statoPrima: 'ESCLUSO', motivoEsclusionePrima: MOTIVO_ESCLUSIONE_CAUSALE })
    )
    expect(e.statoDopo).toBe('DA_COLLEGARE')
    expect(e.ricalcolaProposta).toBe(true)
    expect(e.motivoEsclusione).toBeNull()
  })
  it('ESCLUSO con motivo null/assente: mai riammesso (I2)', () => {
    expect(esitoCorrezione(base({ statoPrima: 'ESCLUSO' })).statoDopo).toBe('ESCLUSO')
    const senzaCampo = { ...base({ statoPrima: 'ESCLUSO' }) } as Partial<InputCorrezione>
    delete senzaCampo.motivoEsclusionePrima
    expect(esitoCorrezione(senzaCampo as InputCorrezione).statoDopo).toBe('ESCLUSO')
  })
  it('annullamento non fatturato: aggiorna il vigente (I1)', () => {
    for (const statoPrima of ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO', 'ESCLUSO'] as const) {
      const e = esitoCorrezione(base({ statoPrima, tipo: 'ANNULLAMENTO' }))
      expect(e.aggiornaVigente && e.aggiornaData).toBe(true)
    }
    expect(
      esitoCorrezione(base({ statoPrima: 'NESSUN_LEGAME', tipo: 'ANNULLAMENTO' })).aggiornaData
    ).toBe(false)
  })
  it('ESCLUSO automatico che cambia causa: il motivo si aggiorna (M1)', () => {
    const e = esitoCorrezione(
      base({
        statoPrima: 'ESCLUSO',
        motivoEsclusionePrima: MOTIVO_ESCLUSIONE_DATA,
        causaleFatturabileDopo: false,
      })
    )
    expect(e.statoDopo).toBe('ESCLUSO')
    expect(e.motivoEsclusione).toBe(MOTIVO_ESCLUSIONE_CAUSALE)
  })
  it('ESCLUSO a mano che diventa anche non fatturabile: il motivo dell utente resta (M1)', () => {
    const e = esitoCorrezione(
      base({
        statoPrima: 'ESCLUSO',
        motivoEsclusionePrima: 'Omaggio',
        causaleFatturabileDopo: false,
      })
    )
    expect(e.statoDopo).toBe('ESCLUSO')
    expect(e.motivoEsclusione).toBeNull()
  })
  it('quantita manuale + quantita cambiata: avviso QUANTITA_MANUALE_NON_DERIVATA (I6)', () => {
    const e = esitoCorrezione(base({ haQuantitaManuali: true, quantitaCambiata: true }))
    expect(e.avvisiDaAggiungere).toEqual(['QUANTITA_MANUALE_NON_DERIVATA'])
    expect(e.statoDopo).toBe('PROPOSTO')
  })
  it('quantita manuale ma quantita invariata, o cambiata senza manuali: nessun avviso (I6)', () => {
    expect(
      esitoCorrezione(base({ haQuantitaManuali: true, quantitaCambiata: false })).avvisiDaAggiungere
    ).toEqual([])
    expect(
      esitoCorrezione(base({ haQuantitaManuali: false, quantitaCambiata: true })).avvisiDaAggiungere
    ).toEqual([])
  })
  it('quantita manuale + CER cambiato: i due avvisi insieme (I6)', () => {
    const e = esitoCorrezione(
      base({ cerCambiato: true, haQuantitaManuali: true, quantitaCambiata: true })
    )
    expect(e.avvisiDaAggiungere).toEqual([
      'CAMBIO_CER_DA_CONFERMARE',
      'QUANTITA_MANUALE_NON_DERIVATA',
    ])
  })
  it('legame fatturato: nessun avviso di quantita, solo scostamento (I6)', () => {
    const e = esitoCorrezione(
      base({ statoPrima: 'FATTURATO', haQuantitaManuali: true, quantitaCambiata: true })
    )
    expect(e.avvisiDaAggiungere).toEqual([])
  })
  it('ESCLUSO per scelta dell utente: resta ESCLUSO anche dopo una rettifica', () => {
    const e = esitoCorrezione(
      base({ statoPrima: 'ESCLUSO', motivoEsclusionePrima: 'Omaggio al cliente' })
    )
    expect(e.statoDopo).toBe('ESCLUSO')
    expect(e.ricalcolaProposta).toBe(false)
    expect(e.motivoEsclusione).toBeNull()
  })
  it('NESSUN_LEGAME + causale fatturabile: ricalcolaProposta (il chiamante decide se crearlo)', () => {
    const e = esitoCorrezione(base({ statoPrima: 'NESSUN_LEGAME' }))
    expect(e.statoDopo).toBe('NESSUN_LEGAME')
    expect(e.ricalcolaProposta).toBe(true)
  })
  it('NESSUN_LEGAME + causale non fatturabile: nessun legame, nessun effetto', () => {
    const e = esitoCorrezione(base({ statoPrima: 'NESSUN_LEGAME', causaleFatturabileDopo: false }))
    expect(e.statoDopo).toBe('NESSUN_LEGAME')
    expect(e.ricalcolaProposta).toBe(false)
    expect(e.motivoEsclusione).toBeNull()
  })
  it('data prima di fatturazioneDa: ESCLUSO con MOTIVO_ESCLUSIONE_DATA', () => {
    const e = esitoCorrezione(
      base({ statoPrima: 'CONFERMATO', dataDopo: '2025-12-31', dataPrima: '2026-02-01' })
    )
    expect(e.statoDopo).toBe('ESCLUSO')
    expect(e.motivoEsclusione).toBe(MOTIVO_ESCLUSIONE_DATA)
    expect(e.aggiornaVigente && e.aggiornaData).toBe(true)
  })
  it('il giorno di fatturazioneDa e incluso', () => {
    const e = esitoCorrezione(base({ dataDopo: '2026-01-01', dataPrima: '2026-01-01' }))
    expect(e.statoDopo).toBe('PROPOSTO')
  })
  it('da prima a dopo fatturazioneDa: DA_COLLEGARE', () => {
    const e = esitoCorrezione(
      base({
        statoPrima: 'ESCLUSO',
        motivoEsclusionePrima: MOTIVO_ESCLUSIONE_DATA,
        dataPrima: '2025-12-01',
        dataDopo: '2026-03-01',
      })
    )
    expect(e.statoDopo).toBe('DA_COLLEGARE')
    expect(e.ricalcolaProposta).toBe(true)
  })
  it('NESSUN_LEGAME con fatturazioneDa null: NESSUN_LEGAME, nessun effetto', () => {
    const e = esitoCorrezione(base({ statoPrima: 'NESSUN_LEGAME', fatturazioneDa: null }))
    expect(e.statoDopo).toBe('NESSUN_LEGAME')
    expect(e.ricalcolaProposta).toBe(false)
  })
  it('fatturazioneDa null con legame esistente non fatturato: nessun vincolo di data', () => {
    const e = esitoCorrezione(base({ fatturazioneDa: null, dataDopo: '1999-01-01' }))
    expect(e.statoDopo).toBe('PROPOSTO')
  })
  it('annullamento non fatturato: ANNULLATO', () => {
    for (const statoPrima of ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO', 'ESCLUSO'] as const) {
      const e = esitoCorrezione(base({ statoPrima, tipo: 'ANNULLAMENTO' }))
      expect(e.statoDopo).toBe('ANNULLATO')
      expect(e.ricalcolaProposta).toBe(false)
      expect(e.ricalcolaQuantitaDaMovimento).toBe(false)
      expect(e.scostamento).toBe(false)
    }
  })
  it('annullamento senza legame: nessun legame', () => {
    expect(
      esitoCorrezione(base({ statoPrima: 'NESSUN_LEGAME', tipo: 'ANNULLAMENTO' })).statoDopo
    ).toBe('NESSUN_LEGAME')
  })
  it('FATTURATO e IMPORTATO_FATTURATO: stato invariato, scostamento, mai ricalcoli, qualunque correzione', () => {
    for (const statoPrima of ['FATTURATO', 'IMPORTATO_FATTURATO'] as const) {
      for (const tipo of ['RETTIFICA', 'ANNULLAMENTO'] as const) {
        const e = esitoCorrezione(
          base({
            statoPrima,
            tipo,
            cerCambiato: true,
            causaleFatturabileDopo: false,
            dataDopo: '2020-01-01',
          })
        )
        expect(e).toEqual({
          statoDopo: statoPrima,
          ricalcolaProposta: false,
          ricontrollaValidita: false,
          ricalcolaQuantitaDaMovimento: false,
          aggiornaVigente: true,
          aggiornaData: false,
          scostamento: true,
          avvisiDaAggiungere: [],
          motivoEsclusione: null,
        })
      }
    }
  })
  it('ANNULLATO non cambia con una rettifica', () => {
    const e = esitoCorrezione(base({ statoPrima: 'ANNULLATO' }))
    expect(e.statoDopo).toBe('ANNULLATO')
    expect(e.ricalcolaProposta).toBe(false)
    expect(e.aggiornaVigente || e.aggiornaData).toBe(false)
  })
  it('lo stato dopo una correzione e sempre ammesso e non e mai CONFERMATO da un CER cambiato', () => {
    for (const statoPrima of STATI_LEGAME as readonly StatoLegame[]) {
      const e = esitoCorrezione(base({ statoPrima, cerCambiato: true }))
      expect(e.statoDopo === 'CONFERMATO' && statoPrima !== 'CONFERMATO').toBe(false)
      if (statoPrima === 'CONFERMATO') expect(e.statoDopo).toBe('PROPOSTO')
    }
  })
})

describe('statoDopoRicalcolo (I3)', () => {
  const ok = { motivi: [], completo: true }
  it('CONFERMATO ancora valido: resta CONFERMATO', () => {
    expect(statoDopoRicalcolo('CONFERMATO', ok)).toBe('CONFERMATO')
  })
  it('CONFERMATO con motivi (es. CONTRATTO_NON_ATTIVO) o incompleto: DA_COLLEGARE, mai CONFERMATO', () => {
    expect(
      statoDopoRicalcolo('CONFERMATO', { motivi: ['CONTRATTO_NON_ATTIVO'], completo: true })
    ).toBe('DA_COLLEGARE')
    expect(statoDopoRicalcolo('CONFERMATO', { motivi: [], completo: false })).toBe('DA_COLLEGARE')
  })
  it('PROPOSTO, DA_COLLEGARE e legame nuovo seguono statoDaProposta (mai CONFERMATO)', () => {
    for (const p of ['PROPOSTO', 'DA_COLLEGARE', 'NESSUN_LEGAME'] as const) {
      expect(statoDopoRicalcolo(p, ok)).toBe('PROPOSTO')
      expect(statoDopoRicalcolo(p, { motivi: ['SENZA_PREZZO'], completo: true })).toBe(
        'DA_COLLEGARE'
      )
      expect(statoDopoRicalcolo(p, { motivi: [], completo: false })).toBe('DA_COLLEGARE')
    }
  })
  it('altri stati: invariati', () => {
    for (const p of ['ESCLUSO', 'ANNULLATO', 'FATTURATO', 'IMPORTATO_FATTURATO'] as const) {
      expect(statoDopoRicalcolo(p, { motivi: ['SENZA_PREZZO'], completo: false })).toBe(p)
    }
  })
})

describe('puoAggiornarePrezzi e transizioneEscludi', () => {
  it('puoAggiornarePrezzi: vero per PROPOSTO, CONFERMATO, DA_COLLEGARE', () => {
    for (const s of ['PROPOSTO', 'CONFERMATO', 'DA_COLLEGARE'] as const) {
      expect(puoAggiornarePrezzi(s)).toBe(true)
    }
  })
  it('puoAggiornarePrezzi: falso per ESCLUSO, ANNULLATO, FATTURATO, IMPORTATO_FATTURATO', () => {
    for (const s of ['ESCLUSO', 'ANNULLATO', 'FATTURATO', 'IMPORTATO_FATTURATO'] as const) {
      expect(puoAggiornarePrezzi(s)).toBe(false)
    }
  })
  it('transizioneEscludi(FATTURATO) e null, come IMPORTATO_FATTURATO e ANNULLATO', () => {
    expect(transizioneEscludi('FATTURATO')).toBeNull()
    expect(transizioneEscludi('IMPORTATO_FATTURATO')).toBeNull()
    expect(transizioneEscludi('ANNULLATO')).toBeNull()
  })
  it('transizioneEscludi: DA_COLLEGARE, PROPOSTO, CONFERMATO -> ESCLUSO; ESCLUSO e gia escluso', () => {
    for (const s of ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO'] as const) {
      expect(transizioneEscludi(s)).toBe('ESCLUSO')
    }
    expect(transizioneEscludi('ESCLUSO')).toBeNull()
  })
})
