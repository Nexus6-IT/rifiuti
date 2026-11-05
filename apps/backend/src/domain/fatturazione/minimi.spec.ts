import { applicaMinimi } from './minimi'
import { listinoDi } from '../../test-support/calcolo-fatturazione-di-test'
import type { RigaSenzaLinea } from './esito-righe'
import type { RigaListinoDaFatturare } from './tipi'

function rg(p: Partial<RigaSenzaLinea>): RigaSenzaLinea {
  return {
    tipoRiga: 'MOVIMENTO',
    legameId: null,
    rigaLegameId: null,
    rigaAddebitoId: 'r1',
    descrizione: 'x',
    dataMovimento: null,
    cerCode: null,
    numeroFir: null,
    quantita: '1',
    unitaMisura: 'KG',
    prezzoUnitario: '0',
    sconto: null,
    importoLordo: '0',
    importoSconto: '0.00',
    prezzoTotale: '0.00',
    codiceIvaId: 'iva22',
    aliquotaIva: '22.00',
    naturaIva: null,
    ...p,
  }
}
const mappa = (...r: RigaListinoDaFatturare[]) => new Map(r.map(x => [x.id, x]))

describe('minimo di riga', () => {
  it('50 su netto 30: MINIMO 20', () => {
    const l = listinoDi({ id: 'a', tipo: 'CER', minimoFatturabile: '50.00' })
    const e = applicaMinimi([rg({ rigaAddebitoId: 'a', prezzoTotale: '30.00' })], [], mappa(l))
    expect(e.righe).toHaveLength(1)
    expect(e.righe[0].tipoRiga).toBe('MINIMO')
    expect(e.righe[0].prezzoTotale).toBe('20.00')
    expect(e.righe[0].descrizione).toBe('Differenza per minimo fatturabile')
  })
  it('due righe della stessa riga di listino: 20 + 25 -> 5', () => {
    const l = listinoDi({ id: 'a', tipo: 'CER', minimoFatturabile: '50.00' })
    const e = applicaMinimi(
      [
        rg({ rigaAddebitoId: 'a', prezzoTotale: '20.00' }),
        rg({ rigaAddebitoId: 'a', prezzoTotale: '25.00' }),
      ],
      [],
      mappa(l)
    )
    expect(e.righe.map(r => r.prezzoTotale)).toEqual(['5.00'])
  })
  it('minimo per categoria: somma della categoria', () => {
    const a = listinoDi({
      id: 'a',
      tipo: 'CER',
      categoriaId: 'u001',
      minimoFatturabile: '50.00',
      minimoPerCategoria: true,
    })
    const b = listinoDi({ id: 'b', tipo: 'CER', categoriaId: 'u001' })
    const c = listinoDi({ id: 'c', tipo: 'CER', categoriaId: 'u002' })
    const e = applicaMinimi(
      [
        rg({ rigaAddebitoId: 'a', prezzoTotale: '20.00' }),
        rg({ rigaAddebitoId: 'b', prezzoTotale: '25.00' }),
        rg({ rigaAddebitoId: 'c', prezzoTotale: '100.00' }),
      ],
      [],
      mappa(a, b, c)
    )
    expect(e.righe.map(r => r.prezzoTotale)).toEqual(['5.00'])
  })
  it('minimo per categoria con minimi diversi: vale il più alto', () => {
    const a = listinoDi({
      id: 'a',
      tipo: 'CER',
      categoriaId: 'u1',
      minimoFatturabile: '50.00',
      minimoPerCategoria: true,
    })
    const b = listinoDi({
      id: 'b',
      tipo: 'CER',
      categoriaId: 'u1',
      minimoFatturabile: '70.00',
      minimoPerCategoria: true,
    })
    const e = applicaMinimi(
      [
        rg({ rigaAddebitoId: 'a', prezzoTotale: '20.00' }),
        rg({ rigaAddebitoId: 'b', prezzoTotale: '25.00' }),
      ],
      [],
      mappa(a, b)
    )
    expect(e.righe.map(r => r.prezzoTotale)).toEqual(['25.00'])
  })
  it('minimo raggiunto: nessuna riga', () => {
    const l = listinoDi({ id: 'a', minimoFatturabile: '50.00' })
    expect(
      applicaMinimi([rg({ rigaAddebitoId: 'a', prezzoTotale: '50.00' })], [], mappa(l)).righe
    ).toHaveLength(0)
  })
})

describe('minimi di documento', () => {
  const cer = listinoDi({ id: 'c', tipo: 'CER', categoriaId: 'u001' })
  const v = listinoDi({ id: 'v', tipo: 'V', categoriaId: 'u002' })
  const base = [
    rg({ rigaAddebitoId: 'c', prezzoTotale: '50.00' }),
    rg({ rigaAddebitoId: 'v', prezzoTotale: '30.00' }),
  ]
  const min = (tipo: string, prezzo: string, p: Partial<RigaListinoDaFatturare> = {}) =>
    listinoDi({ id: 'm', tipo, prezzo, ...p })
  it('MW 100 su 80: 20; su 120: nessuna', () => {
    expect(applicaMinimi(base, [min('MW', '100.00')], mappa(cer, v)).righe[0].prezzoTotale).toBe(
      '20.00'
    )
    expect(applicaMinimi(base, [min('MW', '70.00')], mappa(cer, v)).righe).toHaveLength(0)
    expect(
      applicaMinimi(
        [rg({ rigaAddebitoId: 'c', prezzoTotale: '120.00' })],
        [min('MW', '100.00')],
        mappa(cer)
      ).righe
    ).toHaveLength(0)
  })
  it('MW conta le QUANTITA_MOVIMENTI', () => {
    const r = [
      rg({ rigaAddebitoId: 'c', prezzoTotale: '50.00' }),
      rg({ tipoRiga: 'QUANTITA_MOVIMENTI', rigaAddebitoId: 'tt', prezzoTotale: '60.00' }),
    ]
    expect(applicaMinimi(r, [min('MW', '100.00')], mappa(cer)).righe).toHaveLength(0)
  })
  it('MF solo righe CER', () => {
    expect(applicaMinimi(base, [min('MF', '80.00')], mappa(cer, v)).righe[0].prezzoTotale).toBe(
      '30.00'
    )
  })
  it('M001: solo le righe V della categoria, confronto sul codice (uuid sul categoriaId)', () => {
    const v1 = listinoDi({ id: 'v1', tipo: 'V', categoriaId: 'c-uuid-1', categoriaCodice: '001' })
    const cer1 = listinoDi({
      id: 'c1',
      tipo: 'CER',
      categoriaId: 'c-uuid-1',
      categoriaCodice: '001',
    })
    const v2 = listinoDi({ id: 'v2', tipo: 'V', categoriaId: 'c-uuid-2', categoriaCodice: '002' })
    const r = [
      rg({ rigaAddebitoId: 'v1', prezzoTotale: '30.00' }),
      rg({ rigaAddebitoId: 'c1', prezzoTotale: '50.00' }),
      rg({ rigaAddebitoId: 'v2', prezzoTotale: '40.00' }),
    ]
    const e = applicaMinimi(r, [min('M001', '80.00')], mappa(v1, cer1, v2))
    expect(e.righe.map(x => x.prezzoTotale)).toEqual(['50.00'])
  })
  it('M001 con righe V da 90 e minimo 80: nessuna riga (uuid contro codice)', () => {
    const v1 = listinoDi({ id: 'v1', tipo: 'V', categoriaId: 'c-uuid', categoriaCodice: '001' })
    const e = applicaMinimi(
      [rg({ rigaAddebitoId: 'v1', prezzoTotale: '90.00' })],
      [min('M001', '80.00')],
      mappa(v1)
    )
    expect(e.righe).toHaveLength(0)
  })
  it('minimo senza prezzo: RIGA_LEGAME_INCOMPLETA con «tipo riga n»', () => {
    const e = applicaMinimi(
      base,
      [min('MW', '10.00'), min('MW', '1.00', { prezzo: null })],
      mappa(cer, v)
    )
    expect(e.errori).toEqual([{ codice: 'RIGA_LEGAME_INCOMPLETA', dettaglio: 'MW riga 2' }])
  })
  it('la riga MINIMO non ha unità di misura', () => {
    expect(
      applicaMinimi(base, [min('MW', '100.00')], mappa(cer, v)).righe[0].unitaMisura
    ).toBeNull()
  })
  it('codice IVA della riga MINIMO = quello del minimo', () => {
    const m = min('MW', '100.00', {
      codiceIva: { id: 'iva10', versione: 1, aliquota: '10.00', natura: null, descrizione: '10' },
    })
    const r = applicaMinimi(base, [m], mappa(cer, v)).righe[0]
    expect([r.codiceIvaId, r.aliquotaIva]).toEqual(['iva10', '10.00'])
    expect(r.rigaAddebitoId).toBe('m')
  })
})
