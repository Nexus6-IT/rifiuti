import { controllaRiferimentiListino } from './riferimenti-listino'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const G = '11111111-0000-4000-8000-000000000001'
const C = '22222222-0000-4000-8000-000000000002'
const I = '33333333-0000-4000-8000-000000000003'

function txCon(codifiche: unknown[], codiciIva: unknown[] = []) {
  const sql: string[] = []
  const tx: any = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const s = strings.join('?')
      sql.push(s)
      return s.includes('codici_iva') ? codiciIva : codifiche
    }),
  }
  return { tx, sql }
}

describe('controllaRiferimentiListino', () => {
  it('nessun riferimento: nessuna query', async () => {
    const { tx } = txCon([])
    expect(await controllaRiferimentiListino(tx, T, {})).toEqual([])
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })

  it('legge codifiche e codici IVA con FOR SHARE, una query per tabella', async () => {
    const { tx, sql } = txCon(
      [{ id: G, attivo: true, genere: 'GRUPPO' }],
      [{ id: I, attivo: true }]
    )
    const e = await controllaRiferimentiListino(tx, T, { gruppoId: G, codiceIvaId: I })
    expect(e).toEqual([])
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
    for (const s of sql) expect(s).toContain('FOR SHARE')
  })

  it('genere sbagliato (categoria al posto del gruppo) -> messaggio del gruppo', async () => {
    const { tx } = txCon([{ id: C, attivo: true, genere: 'CATEGORIA' }])
    expect(await controllaRiferimentiListino(tx, T, { gruppoId: C })).toEqual([
      'Il gruppo scelto non esiste, è disattivato o non è un gruppo.',
    ])
  })

  it('codifica disattivata o inesistente -> messaggio; codice IVA disattivato', async () => {
    const { tx } = txCon([{ id: G, attivo: false, genere: 'GRUPPO' }], [{ id: I, attivo: false }])
    expect(
      await controllaRiferimentiListino(tx, T, {
        gruppoId: G,
        categoriaId: C,
        codiceIvaId: I,
      })
    ).toEqual([
      'Il gruppo scelto non esiste, è disattivato o non è un gruppo.',
      'Il codice IVA scelto non esiste o è disattivato.',
      'La categoria scelta non esiste, è disattivata o non è una categoria.',
    ])
  })

  it('stesso id usato per due generi: ognuno controllato per il proprio genere', async () => {
    const { tx } = txCon([{ id: G, attivo: true, genere: 'CENTRO_RICAVO' }])
    expect(
      await controllaRiferimentiListino(tx, T, { centroRicavoId: G, categoriaStatistica1Id: G })
    ).toEqual([
      'La categoria statistica 1 scelta non esiste, è disattivata o non è una categoria statistica 1.',
    ])
  })

  it('id non UUID: non arriva al database e il riferimento risulta non valido', async () => {
    const { tx } = txCon([])
    expect(await controllaRiferimentiListino(tx, T, { gruppoId: 'abc' })).toEqual([
      'Il gruppo scelto non esiste, è disattivato o non è un gruppo.',
    ])
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })
})
