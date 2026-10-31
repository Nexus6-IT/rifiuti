/**
 * Funzioni pure della vista degli abbinamenti (4.6, Task 8): costruzione dell'ambito per la
 * pagina e FIFO da zero per le differenze. Niente database: l'ambito e' scritto a mano.
 */
import type { EventoFifo } from '../../domain/waste-movement/fifo-deposito'
import type { AmbitoAbbinamento } from './lettore-abbinamenti'
import {
  costruisciAmbitoVista,
  fifoDaCapo,
  puoModificare,
  puoRicalcolare,
} from './abbinamenti.service'

const ev = (
  tipo: 'CARICO' | 'SCARICO',
  id: string,
  giorno: string,
  quantita: number,
  ordine: number,
  numero?: string
): EventoFifo => ({
  tipo,
  giorno,
  quantita,
  origine: 'MOVIMENTO',
  ordine,
  riferimento: { id, numero },
})

function ambito(over: Partial<AmbitoAbbinamento> = {}): AmbitoAbbinamento {
  const c1 = {
    chiave: 'M:c1',
    evento: ev('CARICO', 'c1', '2026-01-10', 100, 1, '1/2026'),
    classe: 'R13' as const,
    numero: '1/2026',
  }
  const c2 = {
    chiave: 'M:c2',
    evento: ev('CARICO', 'c2', '2026-01-20', 100, 2, '2/2026'),
    classe: 'R13' as const,
    numero: '2/2026',
  }
  const s1 = {
    radiceId: 's1',
    evento: ev('SCARICO', 's1', '2026-02-01', 150, 3, '3/2026'),
    classeAttesa: 'R13' as const,
    numero: '3/2026',
  }
  const base: AmbitoAbbinamento = {
    registroId: 'r',
    chiaveCer: '990011',
    cerCode: '99 99 11',
    famiglia: 'KG',
    unita: 'kg',
    carichi: [c2, c1],
    scarichi: [s1],
    righe: [],
    righeValide: [],
    righeMorteIds: [],
    righeIncoerenti: [],
    classi: ['R13'],
    diStoccaggio: true,
  }
  return { ...base, ...over }
}

describe('fifoDaCapo', () => {
  it('copre lo scarico dal carico piu vecchio', () => {
    const righe = fifoDaCapo(ambito())
    expect(righe).toEqual([
      { scaricoRadiceId: 's1', carico: 'M:c1', quantita: 100 },
      { scaricoRadiceId: 's1', carico: 'M:c2', quantita: 50 },
    ])
  })

  it('salta gli scarichi a classe indeterminata', () => {
    const a = ambito({ classi: ['R13', 'D15'] })
    a.scarichi[0].classeAttesa = null
    expect(fifoDaCapo(a)).toEqual([])
  })
})

describe('costruisciAmbitoVista', () => {
  it('carichi in ordine FIFO, residui, eta e stati; scarichi dal piu recente', () => {
    const a = ambito({
      righeValide: [
        { scaricoRadiceId: 's1', carico: 'M:c1', quantita: 100, origine: 'AUTOMATICO' },
        { scaricoRadiceId: 's1', carico: 'M:c2', quantita: 50, origine: 'AUTOMATICO' },
      ],
    })
    a.righe = a.righeValide
    const v = costruisciAmbitoVista(a, '2026-03-01')
    expect(v.carichi.map(c => c.numero)).toEqual(['1/2026', '2/2026'])
    expect(v.carichi[0]).toMatchObject({
      tipo: 'MOVIMENTO',
      id: 'c1',
      abbinato: 100,
      residuo: 0,
      etaGiorni: null,
      stato: 'ESAURITO',
    })
    expect(v.carichi[1]).toMatchObject({
      abbinato: 50,
      residuo: 50,
      etaGiorni: 40,
      stato: 'APERTO',
    })
    expect(v.scarichi[0]).toMatchObject({ id: 's1', abbinato: 150, stato: 'ABBINATO' })
    expect(v.scarichi[0].righe.map(r => [r.carico.numero, r.quantita, r.origine])).toEqual([
      ['1/2026', 100, 'AUTOMATICO'],
      ['2/2026', 50, 'AUTOMATICO'],
    ])
    expect(v.differenzeFifo).toBe(0)
  })

  it('un override diverso dal FIFO vale una differenza', () => {
    const a = ambito({
      righeValide: [
        { scaricoRadiceId: 's1', carico: 'M:c2', quantita: 100, origine: 'MANUALE' },
        { scaricoRadiceId: 's1', carico: 'M:c1', quantita: 50, origine: 'MANUALE' },
      ],
    })
    a.righe = a.righeValide
    expect(costruisciAmbitoVista(a, '2026-03-01').differenzeFifo).toBe(1)
  })

  it('scarico non abbinato e parziale; carico successivo allo scarico: incoerente', () => {
    const a = ambito()
    expect(costruisciAmbitoVista(a, '2026-03-01').scarichi[0].stato).toBe('NON_ABBINATO')
    const b = ambito({
      righeValide: [{ scaricoRadiceId: 's1', carico: 'M:c1', quantita: 40, origine: 'MANUALE' }],
    })
    b.righe = b.righeValide
    expect(costruisciAmbitoVista(b, '2026-03-01').scarichi[0].stato).toBe('PARZIALE')
    const c = ambito({
      righeValide: [{ scaricoRadiceId: 's1', carico: 'M:c3', quantita: 10, origine: 'MANUALE' }],
      righeIncoerenti: [{ id: 'x', motivo: 'carico successivo allo scarico' }],
    })
    c.carichi.push({
      chiave: 'M:c3',
      evento: ev('CARICO', 'c3', '2026-02-15', 100, 4, '4/2026'),
      classe: 'R13',
    })
    c.righe = c.righeValide
    const v = costruisciAmbitoVista(c, '2026-03-01')
    expect(v.scarichi[0].stato).toBe('INCOERENTE')
    expect(v.carichi.find(x => x.id === 'c3')?.stato).toBe('INCOERENTE')
    expect(v.incoerenze).toEqual(['carico successivo allo scarico'])
  })
})

describe('permessi della vista', () => {
  it('modifica per SUPER_ADMIN, ADMIN, OPERATOR; ricalcolo solo gli amministratori', () => {
    expect(
      ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'].map(r => puoModificare(r as never))
    ).toEqual([true, true, true, false])
    expect(
      ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'].map(r => puoRicalcolare(r as never))
    ).toEqual([true, true, false, false])
  })
})
