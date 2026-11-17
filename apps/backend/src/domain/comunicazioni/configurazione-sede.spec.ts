import {
  CONSORZI_CONFIGURABILI,
  VERSIONE_SCHEMA_CONFIGURAZIONE,
  configurazionePredefinita,
  validaConfigurazione,
} from './configurazione-sede'

describe('configurazione delle comunicazioni per sede', () => {
  it('versione dello schema = 1 e quattro consorzi', () => {
    expect(VERSIONE_SCHEMA_CONFIGURAZIONE).toBe(1)
    expect(CONSORZI_CONFIGURABILI).toEqual(['CONOU', 'COBAT', 'ORSO', 'ORR'])
  })

  it('predefiniti: ORSO normale, COBAT campagna 00, ORR senza forzature; copie indipendenti', () => {
    expect(configurazionePredefinita('ORSO')).toEqual({ modalita: 'NORMALE' })
    expect(configurazionePredefinita('COBAT')).toEqual({
      campagnaPredefinita: { codice: '00', descrizione: '' },
      pgfPerCer: {},
    })
    expect(configurazionePredefinita('ORR')).toEqual({
      atecoProduttoreMancanteComeZero: false,
      usaAutorizzazioniPredefinite: false,
    })
    expect(configurazionePredefinita('CONOU')).toEqual({ predefinitiPerCer: {} })
    const a = configurazionePredefinita('CONOU')
    a.predefinitiPerCer['130205'] = { prodotto: 'A' }
    expect(configurazionePredefinita('CONOU').predefinitiPerCer).toEqual({})
  })

  it('un oggetto vuoto vale come i predefiniti, per ogni consorzio', () => {
    for (const c of CONSORZI_CONFIGURABILI) {
      expect(validaConfigurazione(c, {})).toEqual({
        ok: true,
        valore: configurazionePredefinita(c),
      })
    }
  })

  it('non oggetti e consorzi sconosciuti rifiutati', () => {
    expect(validaConfigurazione('CONOU', null)).toEqual({
      ok: false,
      errori: ['la configurazione deve essere un oggetto'],
    })
    expect(validaConfigurazione('COREPLA' as never, {})).toEqual({
      ok: false,
      errori: ['consorzio sconosciuto: COREPLA'],
    })
  })

  describe('CONOU', () => {
    it('codice deposito 3-10 caratteri e predefiniti per CER', () => {
      const dati = {
        codiceDeposito: 'DEP001',
        predefinitiPerCer: {
          '130205': { prodotto: 'A', percentualeOlio: 90.5 },
          '160113': { prodotto: 'B' },
        },
      }
      expect(validaConfigurazione('CONOU', dati)).toEqual({ ok: true, valore: dati })
    })
    it('codice deposito troppo corto o lungo rifiutato', () => {
      expect(validaConfigurazione('CONOU', { codiceDeposito: 'AB' }).ok).toBe(false)
      expect(validaConfigurazione('CONOU', { codiceDeposito: 'ABCDEFGHIJK' }).ok).toBe(false)
    })
    it('CER non a 6 cifre, prodotto mancante o errato, percentuale fuori limite rifiutati', () => {
      expect(
        validaConfigurazione('CONOU', { predefinitiPerCer: { '13 02 05': { prodotto: 'A' } } }).ok
      ).toBe(false)
      expect(validaConfigurazione('CONOU', { predefinitiPerCer: { '130205': {} } })).toEqual({
        ok: false,
        errori: ['predefinitiPerCer.130205.prodotto: obbligatorio'],
      })
      expect(
        validaConfigurazione('CONOU', { predefinitiPerCer: { '130205': { prodotto: 'Z' } } }).ok
      ).toBe(false)
      expect(
        validaConfigurazione('CONOU', {
          predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 120 } },
        }).ok
      ).toBe(false)
      expect(validaConfigurazione('CONOU', { predefinitiPerCer: { '130205': 'A' } }).ok).toBe(false)
      expect(
        validaConfigurazione('CONOU', { predefinitiPerCer: { '130205': { prodotto: 'A', x: 1 } } })
          .ok
      ).toBe(false)
    })
    it('campi sconosciuti rifiutati', () => {
      expect(validaConfigurazione('CONOU', { altro: 1 }).ok).toBe(false)
    })
  })

  describe('COBAT', () => {
    it('campagna predefinita e pgf per CER', () => {
      const dati = {
        campagnaPredefinita: { codice: '26', descrizione: 'Campagna' },
        pgfPerCer: { '160601': 'A' },
      }
      expect(validaConfigurazione('COBAT', dati)).toEqual({ ok: true, valore: dati })
    })
    it('descrizione assente = vuota; codice obbligatorio, 2 caratteri', () => {
      expect(validaConfigurazione('COBAT', { campagnaPredefinita: { codice: '26' } })).toEqual({
        ok: true,
        valore: { campagnaPredefinita: { codice: '26', descrizione: '' }, pgfPerCer: {} },
      })
      expect(validaConfigurazione('COBAT', { campagnaPredefinita: { descrizione: 'x' } }).ok).toBe(
        false
      )
      expect(validaConfigurazione('COBAT', { campagnaPredefinita: { codice: '2' } }).ok).toBe(false)
    })
    it('pgf fuori A..E e CER non a 6 cifre rifiutati', () => {
      expect(validaConfigurazione('COBAT', { pgfPerCer: { '160601': 'F' } }).ok).toBe(false)
      expect(validaConfigurazione('COBAT', { pgfPerCer: { '1606': 'A' } }).ok).toBe(false)
    })
  })

  describe('ORSO', () => {
    it('modalita NORMALE o DETTAGLIATA', () => {
      expect(validaConfigurazione('ORSO', { modalita: 'DETTAGLIATA' })).toEqual({
        ok: true,
        valore: { modalita: 'DETTAGLIATA' },
      })
      expect(validaConfigurazione('ORSO', { modalita: 'X' }).ok).toBe(false)
      expect(validaConfigurazione('ORSO', { altro: 1 }).ok).toBe(false)
    })
  })

  describe('ORR', () => {
    it('tipo impianto, autorizzazione e flag', () => {
      const dati = {
        tipoImpianto: 'R/S',
        autorizzazioneImpiantoId: '3f0c9a3e-1f2b-4c55-9d0e-1a2b3c4d5e6f',
        atecoProduttoreMancanteComeZero: true,
        usaAutorizzazioniPredefinite: true,
      }
      expect(validaConfigurazione('ORR', dati)).toEqual({ ok: true, valore: dati })
    })
    it('tipo impianto fuori elenco, uuid non valido, flag non booleani rifiutati', () => {
      expect(validaConfigurazione('ORR', { tipoImpianto: 'XXX' }).ok).toBe(false)
      expect(validaConfigurazione('ORR', { autorizzazioneImpiantoId: 'non-un-uuid' }).ok).toBe(
        false
      )
      expect(validaConfigurazione('ORR', { atecoProduttoreMancanteComeZero: 1 }).ok).toBe(false)
      expect(validaConfigurazione('ORR', { altro: 1 }).ok).toBe(false)
    })
    it('i sette tipi di impianto sono ammessi', () => {
      for (const t of ['STO', 'SMA', 'REC', 'R/S', 'AUT', 'ROT', 'FRA']) {
        expect(validaConfigurazione('ORR', { tipoImpianto: t }).ok).toBe(true)
      }
    })
  })
})
