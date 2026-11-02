import { controllaRiferimentiListino, controllaRiferimentiRiga } from './riferimenti-listino'

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

describe('controllaRiferimentiRiga (R41)', () => {
  const A = '44444444-0000-4000-8000-000000000004'

  function txRiga(opzioni: {
    addebito?: unknown[]
    iva?: unknown[]
    codifiche?: unknown[]
    rentri?: number
    addebiti?: string[]
    cer?: string[]
  }) {
    const sql: string[] = []
    const tx: any = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const s = strings.join('?')
        sql.push(s)
        if (s.includes('"addebiti"')) return opzioni.addebito ?? []
        if (s.includes('codici_iva')) return opzioni.iva ?? []
        return opzioni.codifiche ?? []
      }),
      rentriCodificaSemplice: { count: jest.fn().mockResolvedValue(opzioni.rentri ?? 1) },
      addebito: {
        findMany: jest.fn(async () => (opzioni.addebiti ?? []).map(codice => ({ codice }))),
      },
      cERCode: {
        findMany: jest.fn(async () => (opzioni.cer ?? []).map(code => ({ code }))),
      },
    }
    return { tx, sql }
  }

  it('nessun riferimento: nessuna query', async () => {
    const { tx } = txRiga({})
    expect(await controllaRiferimentiRiga(tx, T, {})).toEqual([])
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.rentriCodificaSemplice.count).not.toHaveBeenCalled()
  })

  it('addebito attivo e non CER: valido, letto FOR SHARE', async () => {
    const { tx, sql } = txRiga({ addebito: [{ attivo: true, tipo: 'V' }] })
    expect(await controllaRiferimentiRiga(tx, T, { addebitoId: A })).toEqual([])
    expect(sql[0]).toContain('FOR SHARE')
  })

  it.each([
    ['inesistente', []],
    ['disattivato', [{ attivo: false, tipo: 'V' }]],
    ['di tipo CER', [{ attivo: true, tipo: 'CER' }]],
  ])('addebito %s: errore sul campo addebitoId', async (_nome, righe) => {
    const { tx } = txRiga({ addebito: righe as unknown[] })
    expect(await controllaRiferimentiRiga(tx, T, { addebitoId: A })).toEqual([
      { campo: 'addebitoId', messaggio: 'L’addebito scelto non esiste o è disattivato.' },
    ])
  })

  it('addebito con id non UUID: non arriva al database', async () => {
    const { tx } = txRiga({})
    const e = await controllaRiferimentiRiga(tx, T, { addebitoId: 'x' })
    expect(e).toHaveLength(1)
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })

  it('codice IVA, categoria e centro: ogni messaggio sul suo campo', async () => {
    const { tx } = txRiga({
      iva: [{ id: I, attivo: false }],
      codifiche: [{ id: C, attivo: true, genere: 'CATEGORIA' }],
    })
    const e = await controllaRiferimentiRiga(tx, T, {
      codiceIvaId: I,
      categoriaId: C,
      centroRicavoId: G,
    })
    expect(e.map(x => x.campo)).toEqual(['codiceIvaId', 'centroRicavoId'])
  })

  it('stato fisico e operazione: per external_id nelle tabelle RENTRI giuste', async () => {
    const { tx } = txRiga({ rentri: 0 })
    const e = await controllaRiferimentiRiga(tx, T, { statoFisico: '9', operazione: '8' })
    expect(e.map(x => x.campo)).toEqual(['statoFisico', 'operazione'])
    expect(tx.rentriCodificaSemplice.count).toHaveBeenNthCalledWith(1, {
      where: { tabella: 'stati-fisici', externalId: '9', presenteInRentri: true },
    })
    expect(tx.rentriCodificaSemplice.count).toHaveBeenNthCalledWith(2, {
      where: { tabella: 'attivita-rs', externalId: '8', presenteInRentri: true },
    })
  })

  it('addebiti proposti: solo codici esistenti di tipo V, anche scritti senza zeri', async () => {
    const { tx } = txRiga({ addebiti: ['00012'] })
    const e = await controllaRiferimentiRiga(tx, T, { addebitiProposti: ['12', '00013'] })
    expect(e).toEqual([
      {
        campo: 'addebitiProposti',
        messaggio: 'Addebito proposto 2: il codice non è un addebito di tipo V dell’archivio.',
      },
    ])
    expect(tx.addebito.findMany.mock.calls[0][0].where).toMatchObject({
      tipo: 'V',
      codice: { in: ['00012', '00013'] },
    })
  })

  it('CER proposti: ogni CER (prima della barra) deve stare nel catalogo, con o senza asterisco', async () => {
    const { tx } = txRiga({ cer: ['20 03 01', '20 01 21*'] })
    const e = await controllaRiferimentiRiga(tx, T, {
      cerProposta: ['20 03 01/R1', '20 01 21', '20 03 99/*', '20 03 01/'],
    })
    expect(e).toEqual([
      { campo: 'cerProposta', messaggio: 'CER proposto 3: il codice CER non è nel catalogo.' },
    ])
  })

  it('CER proposto di forma sbagliata: non è compito di questo controllo', async () => {
    const { tx } = txRiga({ cer: [] })
    expect(await controllaRiferimentiRiga(tx, T, { cerProposta: ['abc'] })).toEqual([])
    expect(tx.cERCode.findMany).not.toHaveBeenCalled()
  })
})
