import {
  anteprimaDate,
  dataItaliana,
  generabile,
  messaggioErroreRitiri,
  modificabile,
  quantitaItaliana,
} from './ritiri.model'
import { ritiroDiProva } from './ritiri-test-utils'

describe('ritiri.model', () => {
  it('formatta data e quantità in italiano senza passare dal fuso', () => {
    expect(dataItaliana('2026-11-12')).toBe('12/11/2026')
    expect(quantitaItaliana('1250.50')).toBe('1.250,5')
    expect(quantitaItaliana('abc')).toBe('abc')
  })

  describe('anteprimaDate', () => {
    it('ogni 7 giorni fino al: include la data di partenza e quella finale', () => {
      expect(anteprimaDate('2026-11-02', { ogniGiorni: 7, fino: '2026-11-23' })).toEqual([
        '2026-11-02',
        '2026-11-09',
        '2026-11-16',
        '2026-11-23',
      ])
    })
    it('ogni N settimane vale N*7 giorni', () => {
      expect(anteprimaDate('2026-11-02', { ogniSettimane: 2, fino: '2026-12-01' })).toEqual([
        '2026-11-02',
        '2026-11-16',
        '2026-11-30',
      ])
    })
    it('si ferma a 52 occorrenze', () => {
      expect(anteprimaDate('2026-01-01', { ogniGiorni: 1, fino: '2027-12-31' }).length).toBe(52)
    })
    it('data finale prima della partenza o intervallo nullo: nessuna data', () => {
      expect(anteprimaDate('2026-11-02', { ogniGiorni: 7, fino: '2026-11-01' })).toEqual([])
      expect(anteprimaDate('2026-11-02', { ogniGiorni: 0, fino: '2026-11-30' })).toEqual([])
      expect(anteprimaDate('', { ogniGiorni: 7, fino: '2026-11-30' })).toEqual([])
    })
    it('attraversa il cambio dell’ora legale senza slittare di giorno', () => {
      expect(anteprimaDate('2026-10-24', { ogniGiorni: 1, fino: '2026-10-27' })).toEqual([
        '2026-10-24',
        '2026-10-25',
        '2026-10-26',
        '2026-10-27',
      ])
    })
  })

  it('generabile e modificabile dipendono da stato e FIR', () => {
    expect(generabile(ritiroDiProva())).toBeTrue()
    expect(generabile(ritiroDiProva({ statoVisibile: 'FIR_BOZZA' }))).toBeFalse()
    expect(
      generabile(ritiroDiProva({ stato: 'ANNULLATO', statoVisibile: 'ANNULLATO' }))
    ).toBeFalse()
    expect(modificabile(ritiroDiProva())).toBeTrue()
    expect(
      modificabile(ritiroDiProva({ fir: { id: 'f1', numero: null, status: 'DRAFT' } }))
    ).toBeFalse()
  })

  it('messaggioErroreRitiri traduce i 409 noti e non mostra altro che il messaggio', () => {
    expect(
      messaggioErroreRitiri({ status: 409, error: { error: 'RITIRO_CON_FIR', message: 'Il ritiro ha un FIR.' } }, 'x')
    ).toContain('annulla prima il FIR')
    expect(
      messaggioErroreRitiri({ status: 409, error: { error: 'RITIRO_MODIFICATO', message: 'Versione vecchia.' } }, 'x')
    ).toContain('modificato da un altro utente')
    expect(messaggioErroreRitiri({ status: 400, error: { message: ['a', 'b'] } }, 'x')).toBe('a b')
    expect(messaggioErroreRitiri({ status: 500 }, 'ripiego')).toBe('ripiego')
  })
})
