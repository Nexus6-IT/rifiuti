import { righeFisse, type MarcatoreEsistente } from './righe-fisse'
import { listinoDi } from './prova-fixture'

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
  it('scadenza di 13 mesi prima: non fatturata', () => {
    const r = listinoDi({ scadenze: [sc(15, 3)], periodoScadenze: 'TP' })
    const e = righeFisse({
      righe: [r],
      periodo: { dal: '2026-04-01', al: '2026-04-30' },
      contratto,
      marcatori: [],
    })
    // 15/03/2026 è 1 mese prima: fatturata; 15/03/2025 no
    expect(e.righe.map(x => x.marcatore?.chiaveCompetenza)).toEqual(['2026-03-15'])
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
      contratto,
      marcatori: [mark('SCADENZA_FISSO', '2026-06-30')],
    })
    expect(e.righe.map(x => x.marcatore?.chiaveCompetenza)).not.toContain('2026-06-30')
  })
})

describe('righeFisse senza scadenze', () => {
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
