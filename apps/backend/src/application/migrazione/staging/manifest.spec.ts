import { FORMATO_STAGING, StagingError, validaManifest } from './manifest'

const SHA = 'a'.repeat(64)

function valido(): Record<string, unknown> {
  return {
    formato: FORMATO_STAGING,
    ditta: '0001',
    anno: 2026,
    databaseOrigine: 'WW00012026',
    estrattoIl: '2026-11-14T00:00:00.000Z',
    tabelle: {
      MOVIMENTI: { file: 'movimenti.jsonl', righe: 2, sha256: SHA, colonne: ['COD', 'CAUS'] },
    },
  }
}

function codice(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof StagingError) return e.codice
    throw e
  }
  return 'NESSUN_ERRORE'
}

describe('validaManifest', () => {
  it('rifiuta __proto__ come nome di tabella o di colonna', () => {
    const t = valido()
    ;(t.tabelle as Record<string, unknown>) = JSON.parse(
      `{"__proto__":{"file":"x.jsonl","righe":0,"sha256":"${SHA}","colonne":["A"]}}`
    )
    expect(codice(() => validaManifest(t, 'WW00012026'))).toBe('MANIFEST_NON_VALIDO')
    const c = valido()
    ;(c.tabelle as Record<string, { colonne: string[] }>).MOVIMENTI.colonne = ['COD', '__proto__']
    expect(codice(() => validaManifest(c, 'WW00012026'))).toBe('MANIFEST_NON_VALIDO')
  })

  it('accetta un manifest coerente con la cartella', () => {
    const m = validaManifest(valido(), 'WW00012026')
    expect(m.ditta).toBe('0001')
    expect(m.tabelle['MOVIMENTI'].righe).toBe(2)
  })

  it('accetta e conserva l estrattore', () => {
    const m = validaManifest(
      { ...valido(), estrattore: { nome: 'x', versione: '1' } },
      'WW00012026'
    )
    expect(m.estrattore).toEqual({ nome: 'x', versione: '1' })
  })

  it('rifiuta un formato sconosciuto', () => {
    expect(
      codice(() => validaManifest({ ...valido(), formato: 'winwaste-staging/2' }, 'WW00012026'))
    ).toBe('FORMATO_SCONOSCIUTO')
  })

  it('rifiuta un database d origine incoerente con ditta e anno', () => {
    expect(
      codice(() => validaManifest({ ...valido(), databaseOrigine: 'WW00022026' }, 'WW00022026'))
    ).toBe('ARCHIVIO_INCOERENTE')
  })

  it('rifiuta una cartella con nome diverso dal database d origine', () => {
    expect(codice(() => validaManifest(valido(), 'WW00012025'))).toBe('ARCHIVIO_INCOERENTE')
  })

  it.each([
    ['non un oggetto', 'testo'],
    ['array', []],
    ['null', null],
  ])('rifiuta un manifest %s', (_nome, valore) => {
    expect(codice(() => validaManifest(valore, 'WW00012026'))).toBe('MANIFEST_NON_VALIDO')
  })

  it.each<[string, Record<string, unknown>]>([
    ['ditta di 3 cifre', { ditta: '001' }],
    ['anno fuori intervallo', { anno: 1989 }],
    ['anno non intero', { anno: 2026.5 }],
    ['databaseOrigine mancante', { databaseOrigine: undefined }],
    ['estrattoIl non ISO', { estrattoIl: 'ieri' }],
    ['estrattore senza versione', { estrattore: { nome: 'x' } }],
    ['tabelle non oggetto', { tabelle: [] }],
  ])('rifiuta: %s', (_nome, modifica) => {
    expect(codice(() => validaManifest({ ...valido(), ...modifica }, 'WW00012026'))).toBe(
      'MANIFEST_NON_VALIDO'
    )
  })

  it.each<[string, Record<string, unknown>]>([
    ['file con percorso', { file: '../movimenti.jsonl' }],
    ['file con estensione sbagliata', { file: 'movimenti.csv' }],
    ['file con maiuscole', { file: 'Movimenti.jsonl' }],
    ['righe negative', { righe: -1 }],
    ['righe non intere', { righe: 1.5 }],
    ['hash corto', { sha256: 'abc' }],
    ['hash maiuscolo', { sha256: 'A'.repeat(64) }],
    ['colonne vuote', { colonne: [] }],
    ['colonne duplicate', { colonne: ['COD', 'COD'] }],
    ['colonna non stringa', { colonne: ['COD', 3] }],
  ])('rifiuta una tabella con %s', (_nome, modifica) => {
    const base = valido()
    const tab = { ...(base.tabelle as Record<string, object>).MOVIMENTI, ...modifica }
    expect(
      codice(() => validaManifest({ ...base, tabelle: { MOVIMENTI: tab } }, 'WW00012026'))
    ).toBe('MANIFEST_NON_VALIDO')
  })

  it('rifiuta due tabelle sullo stesso file', () => {
    const tab = { file: 'a.jsonl', righe: 0, sha256: SHA, colonne: ['COD'] }
    expect(
      codice(() => validaManifest({ ...valido(), tabelle: { A: tab, B: tab } }, 'WW00012026'))
    ).toBe('MANIFEST_NON_VALIDO')
  })

  describe('origine (campo facoltativo)', () => {
    it('un manifest del blocco 1, senza origine, resta valido', () => {
      expect(validaManifest(valido(), 'WW00012026').origine).toBeUndefined()
    })

    it('legge versione di SQL Server, collation e impronta dello schema', () => {
      const origine = {
        versioneSqlServer: '16.0.4135.4',
        collation: 'Latin1_General_CI_AS',
        improntaSchema: SHA,
      }
      expect(validaManifest({ ...valido(), origine }, 'WW00012026').origine).toEqual(origine)
    })

    it.each([
      ['non un oggetto', 'x'],
      ['versione non testo', { versioneSqlServer: 16 }],
      ['collation vuota', { collation: '' }],
      ['impronta non SHA-256', { improntaSchema: 'abc' }],
      ['versione troppo lunga', { versioneSqlServer: 'x'.repeat(41) }],
    ])("rifiuta un'origine %s", (_nome, origine) => {
      expect(codice(() => validaManifest({ ...valido(), origine }, 'WW00012026'))).toBe(
        'MANIFEST_NON_VALIDO'
      )
    })
  })
})
