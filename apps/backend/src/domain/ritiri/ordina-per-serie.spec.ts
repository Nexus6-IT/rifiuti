import { ordinaPerSerie, type RitiroOrdinabile } from './ordina-per-serie'

const r = (
  id: string,
  dataPrevista: string,
  automezzoId: string | null,
  ordineGiro: number | null,
  creatoIl = '2026-11-01T08:00:00Z'
): RitiroOrdinabile & { id: string } => ({ id, dataPrevista, automezzoId, ordineGiro, creatoIl })

const ids = (l: { id: string }[]) => l.map(x => x.id)

describe('ordinaPerSerie', () => {
  it('ordina per data, poi mezzo, poi ordine nel giro, poi creazione', () => {
    const lista = [
      r('e', '2026-11-13', 'A', 1),
      r('d', '2026-11-12', 'B', 1),
      r('c', '2026-11-12', 'A', 2),
      r('b', '2026-11-12', 'A', 1, '2026-11-02T08:00:00Z'),
      r('a', '2026-11-12', 'A', 1, '2026-11-01T08:00:00Z'),
    ]
    expect(ids(ordinaPerSerie(lista))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('senza mezzo e senza ordine vanno in coda al proprio gruppo', () => {
    const lista = [
      r('x', '2026-11-12', null, 1),
      r('y', '2026-11-12', 'A', null),
      r('z', '2026-11-12', 'A', 3),
    ]
    expect(ids(ordinaPerSerie(lista))).toEqual(['z', 'y', 'x'])
  })

  it("è stabile a parità di tutte le chiavi e non modifica l'input", () => {
    const lista = [
      r('1', '2026-11-12', 'A', 1),
      r('2', '2026-11-12', 'A', 1),
      r('3', '2026-11-12', 'A', 1),
    ]
    const copia = [...lista]
    expect(ids(ordinaPerSerie(lista))).toEqual(['1', '2', '3'])
    expect(lista).toEqual(copia)
  })

  it('accetta creatoIl come Date', () => {
    const lista = [
      { ...r('tardi', '2026-11-12', 'A', 1), creatoIl: new Date('2026-11-02T00:00:00Z') },
      { ...r('presto', '2026-11-12', 'A', 1), creatoIl: new Date('2026-11-01T00:00:00Z') },
    ]
    expect(ids(ordinaPerSerie(lista))).toEqual(['presto', 'tardi'])
  })
})
