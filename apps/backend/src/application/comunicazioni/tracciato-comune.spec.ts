import type { MovimentoOrso } from './lettore-movimenti-orso'
import {
  CatalogoIstat,
  aggregaSegnalazioni,
  chiaveNomeComune,
  eNoi,
  ordinaMovimenti,
  progressivoDaNumero,
  soloCifre,
  targaCompatta,
  type DbIstat,
} from './tracciato-comune'

const m = (id: string, numero: string, giorno: string): MovimentoOrso =>
  ({
    id,
    numero,
    cer: '130205',
    movementDate: new Date(`${giorno}T08:00:00Z`),
  }) as MovimentoOrso

describe('tracciato-comune', () => {
  it('chiaveNomeComune: senza accenti, apostrofi uniformi, minuscola', () => {
    expect(chiaveNomeComune('  Sant’Angelo   di Città ')).toBe("sant'angelo di citta")
  })
  it('eNoi confronta CF e P.IVA normalizzati', () => {
    const a = { codiceFiscale: 'abc12345678', partitaIva: '01234567890' }
    expect(eNoi(a, 'ABC12345678', null)).toBe(true)
    expect(eNoi(a, null, ' 01234567890 ')).toBe(true)
    expect(eNoi(a, 'ZZZ', '999')).toBe(false)
    expect(eNoi({ codiceFiscale: null, partitaIva: '' }, '', '')).toBe(false)
  })
  it('soloCifre, targaCompatta, progressivoDaNumero', () => {
    expect(soloCifre('13 02 05*')).toBe('130205')
    expect(targaCompatta('ab 123 cd')).toBe('AB123CD')
    expect(progressivoDaNumero('17/2026')).toEqual({ n: 17, anno: 2026 })
  })
  it('ordinaMovimenti: per data, poi anno e numero di registro', () => {
    const o = ordinaMovimenti([
      m('c', '2/2026', '2026-05-02'),
      m('a', '10/2026', '2026-05-01'),
      m('b', '9/2026', '2026-05-01'),
    ])
    expect(o.map(x => x.id)).toEqual(['b', 'a', 'c'])
  })
  it('aggregaSegnalazioni: raggruppa per codice, bloccanti prima, movimenti senza doppioni', () => {
    const a = aggregaSegnalazioni([
      { codice: 'B', messaggio: 'b', bloccante: false, movimento: m('1', '1/2026', '2026-05-01') },
      { codice: 'A', messaggio: 'a', bloccante: true, movimento: m('1', '1/2026', '2026-05-01') },
      { codice: 'A', messaggio: 'a', bloccante: true, movimento: m('2', '2/2026', '2026-05-01') },
      { codice: 'A', messaggio: 'a', bloccante: true, movimento: m('2', '2/2026', '2026-05-01') },
      {
        codice: 'A',
        messaggio: 'a',
        bloccante: true,
        movimento: m('3', '3/2026', '2026-05-01'),
        correzione: { tipo: 'ANAGRAFICA_SEDE', sedeDittaId: 's' },
      },
    ])
    expect(a.map(x => [x.codice, x.bloccante, x.movimentoIds])).toEqual([
      ['A', true, ['1', '2']],
      ['A', true, ['3']],
      ['B', false, ['1']],
    ])
    expect(a[0].movimenti?.[0]).toMatchObject({
      data: '2026-05-01',
      numero: '1/2026',
      cer: '130205',
    })
  })

  describe('CatalogoIstat', () => {
    const db = {
      istatComune: {
        findMany: jest.fn().mockResolvedValue([
          { code: '016024', name: 'Bergamo', provinciaSigla: 'BG', cap: '24100' },
          { code: '999001', name: 'Forzato', provinciaSigla: 'ZZ', cap: null },
        ]),
      },
      istatProvincia: {
        findMany: jest.fn().mockResolvedValue([
          { sigla: 'BG', code: '016', regione: 'Lombardia' },
          { sigla: 'NA', code: '063', regione: 'Campania' },
        ]),
      },
    } as unknown as DbIstat
    it('risolve per nome e provincia con regione (due query fisse)', async () => {
      const c = await CatalogoIstat.carica(db, [{ comune: 'BERGAMO', provincia: 'bg' }])
      expect(c.risolvi({ comune: 'Bergamo', provincia: 'BG' })).toEqual({
        istat6: '016024',
        regioneCodice: '03',
        regioneLettera: 'D',
      })
      expect(c.risolvi({ comune: 'Altrove', provincia: 'BG' })).toBeNull()
      expect(c.comune('016024')?.cap).toBe('24100')
    })
    it('la forzatura vince; la regione viene dal codice di provincia', async () => {
      const c = await CatalogoIstat.carica(db, [], ['016024'])
      expect(c.risolvi({ comune: 'x', provincia: 'x', codiceIstatForzato: '063049' })).toEqual({
        istat6: '063049',
        regioneCodice: '15',
        regioneLettera: 'P',
      })
      // Codice di provincia sconosciuto: non risolvibile.
      expect(c.risolvi({ comune: 'x', provincia: 'x', codiceIstatForzato: '999001' })).toBeNull()
    })
  })
})
