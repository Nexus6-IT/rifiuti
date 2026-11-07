import { righeFisse as righeFisseDominio, type MarcatoreEsistente } from './righe-fisse'
import { listinoDi } from '../../test-support/calcolo-fatturazione-di-test'

const righeFisse = righeFisseDominio

const contratto = { dataInizio: '2020-01-01', dataFine: null }
const sc = (giorno: number, mese: number, ordine = 1) => ({ ordine, giorno, mese, anno: null })
const trim = listinoDi({
  prezzo: '100.00',
  scadenze: [sc(31, 3), sc(30, 6, 2)],
  periodoScadenze: 'TP',
})
const mark = (tipo: MarcatoreEsistente['tipo'], chiave: string): MarcatoreEsistente => ({
  rigaAddebitoId: 'r1',
  tipo,
  chiaveCompetenza: chiave,
})
const periodo = { dal: '2026-04-01', al: '2026-06-30' }

describe('righeFisse con scadenze', () => {
  it('trimestrale: una riga del 30/06 con marcatore', () => {
    const e = righeFisse({ righe: [trim], periodo, contratto, marcatori: [] })
    const f = e.righe.filter(r => r.marcatore?.chiaveCompetenza === '2026-06-30')
    expect(f).toHaveLength(1)
    expect(f[0].marcatore?.tipo).toBe('SCADENZA_FISSO')
    expect(f[0].tipoRiga).toBe('FISSO')
    expect(f[0].prezzoTotale).toBe('100.00')
    expect(f[0].descrizione).toContain('dal 01/04/2026 al 30/06/2026')
  })
  it('scadenza del 31/12 anno prima: arretrato con avviso', () => {
    const r = listinoDi({ prezzo: '10.00', scadenze: [sc(31, 12)], periodoScadenze: 'TP' })
    const e = righeFisse({ righe: [r], periodo, contratto, marcatori: [] })
    expect(e.righe.map(x => x.marcatore?.chiaveCompetenza)).toEqual(['2025-12-31'])
    expect(e.avvisi.map(a => a.codice)).toEqual(['ARRETRATI_PRESENTI'])
  })
  it('scadenza di 1 mese prima: arretrato fatturato', () => {
    const r = listinoDi({ scadenze: [sc(15, 3)], periodoScadenze: 'TP' })
    const e = righeFisse({
      righe: [r],
      periodo: { dal: '2026-04-01', al: '2026-04-30' },
      contratto,
      marcatori: [],
    })
    expect(e.righe.map(x => x.marcatore?.chiaveCompetenza)).toEqual(['2026-03-15'])
  })
  it('scadenza di 13 mesi prima: non fatturata', () => {
    const r2 = listinoDi({
      scadenze: [{ ordine: 1, giorno: 15, mese: 3, anno: 2025 }],
      periodoScadenze: 'TP',
    })
    const e2 = righeFisse({
      righe: [r2],
      periodo: { dal: '2026-04-01', al: '2026-04-30' },
      contratto,
      marcatori: [],
    })
    expect(e2.righe).toHaveLength(0)
  })
  it('scadenza prima di dataInizio: non fatturata', () => {
    const e = righeFisse({
      righe: [listinoDi({ scadenze: [sc(31, 12)], periodoScadenze: 'TP' })],
      periodo,
      contratto: { dataInizio: '2026-01-01', dataFine: null },
      marcatori: [],
    })
    expect(e.righe).toHaveLength(0)
  })
  it('scadenza con marcatore esistente: nessuna riga', () => {
    const e = righeFisse({
      righe: [listinoDi({ scadenze: [sc(30, 6)], periodoScadenze: 'TP' })],
      periodo,
      contratto: { dataInizio: '2026-01-01', dataFine: null },
      marcatori: [mark('SCADENZA_FISSO', '2026-06-30')],
    })
    expect(e.righe).toHaveLength(0)
  })
})

describe('righeFisse senza scadenze', () => {
  const p0 = { dal: '2026-10-01', al: '2026-10-31' }
  it('contratto finito prima del periodo: nessuna riga', () => {
    const e = righeFisse({
      righe: [listinoDi()],
      periodo: p0,
      contratto: { dataInizio: '2020-01-01', dataFine: '2026-09-15' },
      marcatori: [],
    })
    expect(e.righe).toHaveLength(0)
  })
  it('contratto che inizia dopo il periodo: nessuna riga', () => {
    const e = righeFisse({
      righe: [listinoDi()],
      periodo: p0,
      contratto: { dataInizio: '2026-11-01', dataFine: null },
      marcatori: [],
    })
    expect(e.righe).toHaveLength(0)
  })
  it('contratto che finisce dentro il periodo: canone intero, stessa chiave', () => {
    const e = righeFisse({
      righe: [listinoDi()],
      periodo: p0,
      contratto: { dataInizio: '2020-01-01', dataFine: '2026-10-15' },
      marcatori: [],
    })
    expect(e.righe[0].marcatore?.chiaveCompetenza).toBe('2026-10-01/2026-10-31')
  })
  it('prezzo assente: RIGA_LEGAME_INCOMPLETA con «F» e rigaId', () => {
    const e = righeFisse({
      righe: [listinoDi({ id: 'a', tipo: 'CER' }), listinoDi({ id: 'b', prezzo: null })],
      periodo: p0,
      contratto,
      marcatori: [],
    })
    expect(e.righe).toHaveLength(0)
    expect(e.errori).toEqual([{ codice: 'RIGA_LEGAME_INCOMPLETA', dettaglio: 'F', rigaId: 'b' }])
  })

  const r = listinoDi({ prezzo: '50.00' })
  const p = { dal: '2026-10-01', al: '2026-10-31' }
  it('riga con PERIODO_CANONE', () => {
    const e = righeFisse({ righe: [r], periodo: p, contratto, marcatori: [] })
    expect(e.righe).toHaveLength(1)
    expect(e.righe[0].marcatore).toEqual({
      tipo: 'PERIODO_CANONE',
      chiaveCompetenza: '2026-10-01/2026-10-31',
    })
  })
  it('stesso periodo già marcato: nessuna riga', () => {
    const e = righeFisse({
      righe: [r],
      periodo: p,
      contratto,
      marcatori: [mark('PERIODO_CANONE', '2026-10-01/2026-10-31')],
    })
    expect(e.righe).toHaveLength(0)
    expect(e.errori).toHaveLength(0)
  })
  it('sovrapposto: CANONE_PERIODO_SOVRAPPOSTO', () => {
    const e = righeFisse({
      righe: [r],
      periodo: p,
      contratto,
      marcatori: [mark('PERIODO_CANONE', '2026-10-15/2026-11-14')],
    })
    expect(e.righe).toHaveLength(0)
    expect(e.errori[0].codice).toBe('CANONE_PERIODO_SOVRAPPOSTO')
  })
  it('quantita_fissa null = 1, "0" = nessuna riga', () => {
    expect(righeFisse({ righe: [r], periodo: p, contratto, marcatori: [] }).righe[0].quantita).toBe(
      '1'
    )
    const e = righeFisse({
      righe: [listinoDi({ quantitaFissa: '0' })],
      periodo: p,
      contratto,
      marcatori: [],
    })
    expect(e.righe).toHaveLength(0)
  })
})

describe('righeFisse: F senza prezzo (decisione 21)', () => {
  const p = { dal: '2026-04-01', al: '2026-06-30' }
  const sc = (giorno: number, mese: number) => ({ ordine: 1, giorno, mese, anno: null })
  const ctr = { dataInizio: '2020-01-01', dataFine: null }

  it('senza prezzo e senza scadenze nel periodo: nessun errore', () => {
    // scadenza con anno fisso, fuori dal periodo e dai 12 mesi di arretrati
    const r = listinoDi({
      prezzo: null,
      scadenze: [{ ordine: 1, giorno: 31, mese: 3, anno: 2020 }],
      periodoScadenze: 'TP',
    })
    const e = righeFisse({ righe: [r], periodo: p, contratto: ctr, marcatori: [] })
    expect(e.errori).toEqual([])
    expect(e.righe).toEqual([])
  })
  it('con una scadenza nel periodo: RIGA_LEGAME_INCOMPLETA, una sola volta', () => {
    const r = listinoDi({
      prezzo: null,
      scadenze: [sc(30, 6), sc(31, 3)],
      periodoScadenze: 'TP',
    })
    const e = righeFisse({ righe: [r], periodo: p, contratto: ctr, marcatori: [] })
    expect(e.righe).toHaveLength(0)
    expect(e.errori).toEqual([{ codice: 'RIGA_LEGAME_INCOMPLETA', dettaglio: 'F', rigaId: 'r1' }])
  })
  it('scadenza gia fatturata (marcatore): nessun errore', () => {
    const r = listinoDi({ id: 'r1', prezzo: null, scadenze: [sc(30, 6)], periodoScadenze: 'TP' })
    const e = righeFisse({
      righe: [r],
      periodo: { dal: '2026-04-01', al: '2026-06-30' },
      contratto: { dataInizio: '2026-01-01', dataFine: null },
      marcatori: [{ rigaAddebitoId: 'r1', tipo: 'SCADENZA_FISSO', chiaveCompetenza: '2026-06-30' }],
    })
    expect(e.errori).toEqual([])
  })
  it('canone senza prezzo, contratto non attivo nel periodo: nessun errore', () => {
    const r = listinoDi({ prezzo: null })
    const e = righeFisse({
      righe: [r],
      periodo: p,
      contratto: { dataInizio: '2027-01-01', dataFine: null },
      marcatori: [],
    })
    expect(e.errori).toEqual([])
  })
  it('canone senza prezzo nel periodo del contratto: RIGA_LEGAME_INCOMPLETA', () => {
    const e = righeFisse({
      righe: [listinoDi({ prezzo: null })],
      periodo: p,
      contratto: ctr,
      marcatori: [],
    })
    expect(e.errori).toEqual([{ codice: 'RIGA_LEGAME_INCOMPLETA', dettaglio: 'F', rigaId: 'r1' }])
  })
})
