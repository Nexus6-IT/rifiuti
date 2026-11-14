import { VERSIONE_SCHEMA_DATI, percentualeOlioValida, validaDatiTracciato } from './dati-tracciato'

describe('dati del tracciato per movimento', () => {
  it('versione dello schema = 1 per ogni tracciato', () => {
    expect(VERSIONE_SCHEMA_DATI).toEqual({ CONOU: 1, COBAT: 1, ORR: 1 })
  })

  it('non oggetti rifiutati', () => {
    for (const v of [null, undefined, 'x', 3, [1]]) {
      expect(validaDatiTracciato('CONOU', v)).toEqual({
        ok: false,
        errori: ['i dati devono essere un oggetto'],
      })
    }
  })

  it('tracciato sconosciuto rifiutato', () => {
    expect(validaDatiTracciato('ORSO' as never, {})).toEqual({
      ok: false,
      errori: ['tracciato sconosciuto: ORSO'],
    })
  })

  describe('conou-v1', () => {
    it('oggetto vuoto valido; valori validi conservati', () => {
      expect(validaDatiTracciato('CONOU', {})).toEqual({ ok: true, valore: {} })
      const dati = {
        prodotto: 'A',
        percentualeOlio: 84.99,
        causale: 'U',
        scaricoInterno: true,
        formulario: { serie: 'ABC', numero: '123', anno: '2026' },
      }
      expect(validaDatiTracciato('CONOU', dati)).toEqual({ ok: true, valore: dati })
    })

    it('campi sconosciuti rifiutati (strict)', () => {
      const r = validaDatiTracciato('CONOU', { prodotto: 'A', extra: 1 })
      expect(r).toEqual({ ok: false, errori: ['extra: campo sconosciuto'] })
    })

    it('prodotto e causale solo tra i valori ammessi', () => {
      const r = validaDatiTracciato('CONOU', { prodotto: 'F', causale: 'X' })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errori).toEqual([
          'prodotto: uno tra A, B, C, E, G',
          'causale: uno tra B, E, U, M, D, L',
        ])
      }
    })

    it('percentualeOlio: 0 < p <= 99.99 con due decimali', () => {
      expect(percentualeOlioValida(0.01)).toBe(true)
      expect(percentualeOlioValida(99.99)).toBe(true)
      expect(percentualeOlioValida(84.5)).toBe(true)
      expect(percentualeOlioValida(0)).toBe(false)
      expect(percentualeOlioValida(-1)).toBe(false)
      expect(percentualeOlioValida(100)).toBe(false)
      expect(percentualeOlioValida(84.999)).toBe(false)
      expect(percentualeOlioValida(Number.NaN)).toBe(false)
      expect(validaDatiTracciato('CONOU', { percentualeOlio: 100 }).ok).toBe(false)
      expect(validaDatiTracciato('CONOU', { percentualeOlio: '50' }).ok).toBe(false)
    })

    it('scaricoInterno deve essere booleano', () => {
      expect(validaDatiTracciato('CONOU', { scaricoInterno: 'si' }).ok).toBe(false)
    })

    it('formulario: serie fino a 6 lettere, numero fino a 10, anno 2020-2099, tutti obbligatori', () => {
      expect(
        validaDatiTracciato('CONOU', { formulario: { serie: '', numero: '1', anno: '2026' } }).ok
      ).toBe(true)
      expect(
        validaDatiTracciato('CONOU', {
          formulario: { serie: 'ABCDEFG', numero: '1', anno: '2026' },
        }).ok
      ).toBe(false)
      expect(
        validaDatiTracciato('CONOU', {
          formulario: { serie: 'A', numero: '12345678901', anno: '2026' },
        }).ok
      ).toBe(false)
      expect(
        validaDatiTracciato('CONOU', { formulario: { serie: 'A', numero: '1', anno: '2019' } }).ok
      ).toBe(false)
      const r = validaDatiTracciato('CONOU', { formulario: { serie: 'A' } })
      expect(r).toEqual({
        ok: false,
        errori: ['formulario.numero: obbligatorio', 'formulario.anno: obbligatorio'],
      })
      expect(validaDatiTracciato('CONOU', { formulario: 'x' }).ok).toBe(false)
    })

    it('comuneRaccolta solo con causale B, con ISTAT a 6 cifre e indirizzo', () => {
      const comune = { istat: '063049', indirizzo: 'Via Roma', civico: '12' }
      expect(validaDatiTracciato('CONOU', { causale: 'B', comuneRaccolta: comune })).toEqual({
        ok: true,
        valore: { causale: 'B', comuneRaccolta: comune },
      })
      const senzaB = validaDatiTracciato('CONOU', { causale: 'E', comuneRaccolta: comune })
      expect(senzaB).toEqual({
        ok: false,
        errori: ['comuneRaccolta: ammesso solo con causale B (bonifica)'],
      })
      expect(
        validaDatiTracciato('CONOU', {
          causale: 'B',
          comuneRaccolta: { istat: '63049', indirizzo: 'x' },
        }).ok
      ).toBe(false)
      expect(
        validaDatiTracciato('CONOU', { causale: 'B', comuneRaccolta: { istat: '063049' } }).ok
      ).toBe(false)
      expect(
        validaDatiTracciato('CONOU', {
          causale: 'B',
          comuneRaccolta: { istat: '063049', indirizzo: 'x', civico: '12345678' },
        }).ok
      ).toBe(false)
    })
  })

  describe('cobat-v1', () => {
    it('valori validi conservati', () => {
      const dati = {
        tipoMovimento: 3,
        causa: 5,
        pgf: 'C',
        campagna: { codice: '26', descrizione: 'Campagna 2026' },
      }
      expect(validaDatiTracciato('COBAT', dati)).toEqual({ ok: true, valore: dati })
      expect(validaDatiTracciato('COBAT', {})).toEqual({ ok: true, valore: {} })
    })
    it('tipoMovimento 1..7, causa 1..5, pgf A..E', () => {
      expect(validaDatiTracciato('COBAT', { tipoMovimento: 0 }).ok).toBe(false)
      expect(validaDatiTracciato('COBAT', { tipoMovimento: 8 }).ok).toBe(false)
      expect(validaDatiTracciato('COBAT', { tipoMovimento: 2.5 }).ok).toBe(false)
      expect(validaDatiTracciato('COBAT', { causa: 6 }).ok).toBe(false)
      expect(validaDatiTracciato('COBAT', { pgf: 'F' }).ok).toBe(false)
    })
    it('campagna: codice di 2 caratteri, descrizione fino a 30, entrambi presenti', () => {
      expect(validaDatiTracciato('COBAT', { campagna: { codice: '2', descrizione: '' } }).ok).toBe(
        false
      )
      expect(
        validaDatiTracciato('COBAT', { campagna: { codice: '26', descrizione: 'x'.repeat(31) } }).ok
      ).toBe(false)
      expect(validaDatiTracciato('COBAT', { campagna: { codice: '26' } })).toEqual({
        ok: false,
        errori: ['campagna.descrizione: obbligatorio (anche vuoto)'],
      })
    })
    it('campi sconosciuti rifiutati', () => {
      expect(validaDatiTracciato('COBAT', { tipo: 1 }).ok).toBe(false)
    })
  })

  describe('orr-v1', () => {
    it('valori validi conservati', () => {
      const dati = {
        attivita: 'FRA',
        formulario: { numero: 'ABC123456789012', data: '2026-02-28' },
      }
      expect(validaDatiTracciato('ORR', dati)).toEqual({ ok: true, valore: dati })
      expect(validaDatiTracciato('ORR', {})).toEqual({ ok: true, valore: {} })
    })
    it('attivita solo FRA ROT AUT', () => {
      expect(validaDatiTracciato('ORR', { attivita: 'STO' }).ok).toBe(false)
    })
    it('formulario: numero fino a 15, data valida', () => {
      expect(
        validaDatiTracciato('ORR', { formulario: { numero: 'x'.repeat(16), data: '2026-01-01' } })
          .ok
      ).toBe(false)
      expect(
        validaDatiTracciato('ORR', { formulario: { numero: '1', data: '2026-02-30' } }).ok
      ).toBe(false)
      expect(validaDatiTracciato('ORR', { formulario: { numero: '1', data: '1/1/2026' } }).ok).toBe(
        false
      )
      expect(validaDatiTracciato('ORR', { formulario: { numero: '1' } })).toEqual({
        ok: false,
        errori: ['formulario.data: obbligatorio'],
      })
    })
    it('campi sconosciuti rifiutati', () => {
      expect(validaDatiTracciato('ORR', { x: 1 }).ok).toBe(false)
    })
  })
})
