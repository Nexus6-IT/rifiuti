import {
  riferimentiCaricoPerScarichi,
  type EventoPerRiferimenti,
} from './riferimenti-carico-rentri'
import type { NumeroRegistrazione } from './mappa-registrazione-rentri'

function carico(
  id: string,
  giorno: string,
  quantita: number,
  extra: Partial<EventoPerRiferimenti> = {}
): EventoPerRiferimenti {
  return {
    tipo: 'CARICO',
    giorno,
    quantita,
    unit: 'KG',
    cerCode: '15 01 01',
    origine: 'MOVIMENTO',
    ordine: 2026 * 1e7 + Number(id.replace(/\D/g, '')),
    riferimento: { id },
    ...extra,
  }
}
function scarico(
  id: string,
  giorno: string,
  quantita: number,
  extra: Partial<EventoPerRiferimenti> = {}
): EventoPerRiferimenti {
  return carico(id, giorno, quantita, { tipo: 'SCARICO', ...extra })
}
const n = (progressivo: number, anno = 2026): NumeroRegistrazione => ({ anno, progressivo })

describe('riferimentiCaricoPerScarichi', () => {
  it('scarico che consuma due carichi: due riferimenti in ordine', () => {
    const eventi = [
      carico('c1', '2026-03-01', 60),
      carico('c2', '2026-03-02', 60),
      scarico('s3', '2026-03-03', 100),
    ]
    const numeri = new Map([
      ['c1', n(1)],
      ['c2', n(2)],
      ['s3', n(3)],
    ])
    const r = riferimentiCaricoPerScarichi(eventi, numeri, new Map())
    expect(r.get('s3')).toEqual([n(1), n(2)])
  })

  it("scarico coperto da un'apertura con due origini: le due origini", () => {
    const eventi = [
      carico('ap1', '2026-01-01', 100, { origine: 'APERTURA', ordine: 0 }),
      scarico('s1', '2026-03-03', 50),
    ]
    const origini = new Map([['ap1', [n(9, 2025), n(4, 2025)]]])
    const r = riferimentiCaricoPerScarichi(eventi, new Map([['s1', n(1)]]), origini)
    expect(r.get('s1')).toEqual([n(4, 2025), n(9, 2025)])
  })

  it('apertura senza origini: nessun riferimento', () => {
    const eventi = [
      carico('ap1', '2026-01-01', 100, { origine: 'APERTURA', ordine: 0 }),
      scarico('s1', '2026-03-03', 50),
    ]
    const r = riferimentiCaricoPerScarichi(eventi, new Map(), new Map([['ap1', []]]))
    expect(r.get('s1')).toEqual([])
  })

  it('kg e litri dello stesso CER non si mescolano', () => {
    const eventi = [
      carico('c1', '2026-03-01', 100, { unit: 'KG' }),
      carico('c2', '2026-03-01', 100, { unit: 'L' }),
      scarico('s3', '2026-03-02', 50, { unit: 'L' }),
    ]
    const numeri = new Map([
      ['c1', n(1)],
      ['c2', n(2)],
    ])
    expect(riferimentiCaricoPerScarichi(eventi, numeri, new Map()).get('s3')).toEqual([n(2)])
  })

  it('tonnellate e chilogrammi sono la stessa famiglia', () => {
    const eventi = [carico('c1', '2026-03-01', 1, { unit: 'T' }), scarico('s2', '2026-03-02', 500)]
    expect(
      riferimentiCaricoPerScarichi(eventi, new Map([['c1', n(1)]]), new Map()).get('s2')
    ).toEqual([n(1)])
  })

  it('CER con e senza asterisco: stesso insieme', () => {
    const eventi = [
      carico('c1', '2026-03-01', 100, { cerCode: '16 05 06*' }),
      scarico('s2', '2026-03-02', 50, { cerCode: '160506' }),
    ]
    expect(
      riferimentiCaricoPerScarichi(eventi, new Map([['c1', n(1)]]), new Map()).get('s2')
    ).toEqual([n(1)])
  })

  it('nessun doppione se lo stesso carico copre due parti dello scarico', () => {
    // Due aperture con la stessa origine: il riferimento compare una volta sola.
    const eventi = [
      carico('ap1', '2026-01-01', 30, { origine: 'APERTURA', ordine: 0 }),
      carico('ap2', '2026-01-02', 30, { origine: 'APERTURA', ordine: 0 }),
      scarico('s1', '2026-03-03', 50),
    ]
    const origini = new Map([
      ['ap1', [n(5, 2025)]],
      ['ap2', [n(5, 2025)]],
    ])
    expect(riferimentiCaricoPerScarichi(eventi, new Map(), origini).get('s1')).toEqual([n(5, 2025)])
  })

  it('scarico scoperto: solo i riferimenti della parte coperta', () => {
    const eventi = [
      carico('c1', '2026-03-01', 10),
      scarico('s2', '2026-03-02', 100),
      scarico('s3', '2026-03-03', 5),
    ]
    const numeri = new Map([['c1', n(1)]])
    const r = riferimentiCaricoPerScarichi(eventi, numeri, new Map())
    expect(r.get('s2')).toEqual([n(1)])
    expect(r.get('s3')).toEqual([])
  })

  it('un carico senza numero noto non produce riferimenti', () => {
    const eventi = [carico('c1', '2026-03-01', 10), scarico('s2', '2026-03-02', 5)]
    expect(riferimentiCaricoPerScarichi(eventi, new Map(), new Map()).get('s2')).toEqual([])
  })

  it('carico successivo allo scarico: nessun riferimento', () => {
    const eventi = [scarico('s1', '2026-03-01', 50), carico('c2', '2026-03-05', 100)]
    const r = riferimentiCaricoPerScarichi(eventi, new Map([['c2', n(2)]]), new Map())
    expect(r.get('s1')).toEqual([])
  })

  it('scarico in parte coperto prima e saldato dopo: solo il carico precedente', () => {
    const eventi = [
      carico('c1', '2026-03-01', 10),
      scarico('s2', '2026-03-02', 50),
      carico('c3', '2026-03-05', 100),
    ]
    const numeri = new Map([
      ['c1', n(1)],
      ['c3', n(3)],
    ])
    expect(riferimentiCaricoPerScarichi(eventi, numeri, new Map()).get('s2')).toEqual([n(1)])
  })

  it("carico in L e scarico in M3 dello stesso CER: il riferimento c'e'", () => {
    const eventi = [
      carico('c1', '2026-03-01', 3000, { unit: 'L' }),
      scarico('s2', '2026-03-02', 2, { unit: 'M3' }),
    ]
    expect(
      riferimentiCaricoPerScarichi(eventi, new Map([['c1', n(1)]]), new Map()).get('s2')
    ).toEqual([n(1)])
  })

  it('massa e volume dello stesso CER restano separati', () => {
    const eventi = [
      carico('c1', '2026-03-01', 100, { unit: 'KG' }),
      scarico('s2', '2026-03-02', 1, { unit: 'M3' }),
    ]
    expect(
      riferimentiCaricoPerScarichi(eventi, new Map([['c1', n(1)]]), new Map()).get('s2')
    ).toEqual([])
  })
})
