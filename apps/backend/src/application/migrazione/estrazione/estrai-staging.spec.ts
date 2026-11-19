import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { analizzaArchivio } from '../analisi/analizza-archivio'
import { TABELLE_DOCUMENTATE } from '../staging/colonne-documentate'
import { apriStaging } from '../staging/lettore-staging'
import {
  ColonnaSql,
  costruisciSelect,
  eScrittura,
  espressioneColonna,
  estraiStaging,
  improntaSchema,
  EstrazioneError,
  redigiRiga,
  SorgenteSql,
} from './estrai-staging'

const FIXTURE = join(__dirname, '../../../../test/fixtures/winwaste/WW00012026')

/** Tipo SQL Server (sys.types) ricavato dalla dichiarazione documentata, es. `varchar(2)` -> `varchar`. */
const tipoBase = (tipoSql: string): string =>
  tipoSql
    .replace(/\(.*\)/, '')
    .replace(' identity', '')
    .trim()

function colonneDi(tabella: string): ColonnaSql[] {
  const t = TABELLE_DOCUMENTATE.find(x => x.nome === tabella)!
  return t.colonne.map(c => ({ nome: c.nome, tipo: tipoBase(c.tipoSql) }))
}

/** Tabelle presenti nella fixture del blocco 1: le altre del catalogo risultano assenti dal database. */
const TABELLE_FIXTURE = [
  'MOVIMENTI',
  'FORMULARI',
  'GIACENZE RIFIUTI',
  'CAUSALI RIFIUTI',
  'REGISTRI RIFIUTI',
  'VERSIS',
  'RENregistrazioni',
]

/** Sorgente finta che serve le righe della fixture, come se arrivassero da SQL Server. */
async function sorgenteDaFixture(
  permessi: string[] = ['SELECT', 'CONNECT'],
  tabelleAssenti: string[] = []
): Promise<SorgenteSql & { select: string[] }> {
  const staging = await apriStaging(FIXTURE)
  const select: string[] = []
  return {
    database: 'WW00012026',
    select,
    permessiEffettivi: async () => permessi,
    elencaColonne: async t =>
      tabelleAssenti.includes(t) || !TABELLE_FIXTURE.includes(t) ? [] : colonneDi(t),
    leggiRighe: sql => {
      select.push(sql)
      const tabella = /FROM \[dbo\]\.\[([^\]]+)\]/.exec(sql)![1]
      const colonne = staging.colonne(tabella)
      return (async function* () {
        for await (const el of staging.leggi(tabella)) {
          if (el.tipo === 'riga') yield colonne.map(c => el.riga.campi[c])
        }
      })()
    },
  }
}

describe('eScrittura', () => {
  it.each([
    'INSERT',
    'UPDATE',
    'DELETE',
    'CONTROL',
    'CONTROL SERVER',
    'TAKE OWNERSHIP',
    'ALTER',
    'ALTER ANY USER',
    'CREATE TABLE',
    'create view',
    ' insert ',
  ])('%s e un permesso di scrittura', p => expect(eScrittura(p)).toBe(true))
  it.each(['SELECT', 'CONNECT', 'VIEW DEFINITION', 'EXECUTE', 'REFERENCES', 'VIEW ANY DEFINITION'])(
    '%s non lo e',
    p => expect(eScrittura(p)).toBe(false)
  )
})

describe('espressioneColonna', () => {
  const e = (tipo: string) => espressioneColonna('t', { nome: 'C', tipo })
  it('converte ogni tipo in testo sul server', () => {
    expect(e('int')).toBe('CAST([t].[C] AS NVARCHAR(40))')
    expect(e('decimal')).toBe('CAST([t].[C] AS NVARCHAR(64))')
    expect(e('varchar')).toBe('CAST([t].[C] AS NVARCHAR(MAX))')
    expect(e('text')).toBe('CAST([t].[C] AS NVARCHAR(MAX))')
    expect(e('bit')).toBe('CAST([t].[C] AS NVARCHAR(1))')
    expect(e('uniqueidentifier')).toBe('CAST([t].[C] AS NVARCHAR(36))')
    expect(e('datetime')).toBe('CONVERT(NVARCHAR(40), [t].[C], 126)')
    expect(e('varbinary')).toBe('CONVERT(VARCHAR(MAX), CAST([t].[C] AS VARBINARY(MAX)), 1)')
  })
  it('rifiuta un tipo non gestito invece di indovinarlo', () => {
    expect(() => e('xml')).toThrow(EstrazioneError)
    expect(() => e('sql_variant')).toThrow(/TIPO_NON_SUPPORTATO/)
  })
  it('quota gli identificativi (raddoppia la parentesi quadra di chiusura)', () => {
    expect(espressioneColonna('t', { nome: 'a]b', tipo: 'int' })).toBe(
      'CAST([t].[a]]b] AS NVARCHAR(40))'
    )
  })
})

describe('costruisciSelect', () => {
  it('SELECT di sola lettura, ordinata per chiave sulle colonne originali', () => {
    const sql = costruisciSelect('MOVIMENTI', [
      { nome: 'COD', tipo: 'int' },
      { nome: 'CAUS', tipo: 'varchar' },
    ])
    expect(sql).toBe(
      'SELECT CAST([t].[COD] AS NVARCHAR(40)) AS [COD], CAST([t].[CAUS] AS NVARCHAR(MAX)) AS [CAUS] FROM [dbo].[MOVIMENTI] AS [t] ORDER BY [t].[COD]'
    )
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|EXEC)\b/i)
  })

  it('la chiave composta di GIACENZE RIFIUTI; senza colonne di ordinamento niente ORDER BY', () => {
    const colonne = colonneDi('GIACENZE RIFIUTI')
    expect(costruisciSelect('GIACENZE RIFIUTI', colonne)).toContain(
      'ORDER BY [t].[UL], [t].[MAG], [t].[POS], [t].[CER], [t].[SF], [t].[RIF]'
    )
    expect(costruisciSelect('MOVIMENTI', [{ nome: 'CAUS', tipo: 'varchar' }])).not.toContain(
      'ORDER BY'
    )
  })

  it('una tabella fuori catalogo non si legge mai', () => {
    expect(() => costruisciSelect('UTENTI', [{ nome: 'COD', tipo: 'int' }])).toThrow(
      /TABELLA_NON_AMMESSA/
    )
    expect(() => costruisciSelect('MOVIMENTI]; DROP TABLE x;--', [])).toThrow(EstrazioneError)
  })

  it('VERSIS: C1..C5 non sono mai letti dalla query (per nessuna riga)', () => {
    const sql = costruisciSelect('VERSIS', colonneDi('VERSIS'))
    for (const c of ['C1', 'C2', 'C3', 'C4', 'C5']) {
      expect(sql).toContain(`N'' AS [${c}]`)
      expect(sql).not.toContain(`[t].[${c}]`)
    }
    expect(sql).not.toContain('CASE')
    expect(sql).toContain('CAST([t].[IDSIS] AS NVARCHAR')
  })

  it('VERSIS senza colonna COD: C1..C5 comunque non letti', () => {
    const sql = costruisciSelect('VERSIS', [{ nome: 'C3', tipo: 'varchar' }])
    expect(sql).toBe("SELECT N'' AS [C3] FROM [dbo].[VERSIS] AS [t]")
  })

  it('float/real con CONVERT stile 3 (17 cifre), money con stile 2 (4 decimali), decimal con CAST', () => {
    const sql = costruisciSelect('MOVIMENTI', [
      { nome: 'A', tipo: 'float' },
      { nome: 'B', tipo: 'real' },
      { nome: 'C', tipo: 'money' },
      { nome: 'D', tipo: 'smallmoney' },
      { nome: 'E', tipo: 'decimal' },
    ])
    expect(sql).toContain('CONVERT(NVARCHAR(64), [t].[A], 3) AS [A]')
    expect(sql).toContain('CONVERT(NVARCHAR(64), [t].[B], 3) AS [B]')
    expect(sql).toContain('CONVERT(NVARCHAR(64), [t].[C], 2) AS [C]')
    expect(sql).toContain('CONVERT(NVARCHAR(64), [t].[D], 2) AS [D]')
    expect(sql).toContain('CAST([t].[E] AS NVARCHAR(64)) AS [E]')
  })
})

describe('costruisciSelect: tabelle del catalogo esteso', () => {
  it('RENesportazioni: DOCUMENTO non e mai letto, anche se il database lo ha', () => {
    const sql = costruisciSelect('RENesportazioni', [
      { nome: 'ID', tipo: 'varchar' },
      { nome: 'DOCUMENTO', tipo: 'text' },
      { nome: 'HASH', tipo: 'varchar' },
    ])
    expect(sql).not.toContain('DOCUMENTO')
    expect(sql).toContain('[t].[HASH]')
    expect(sql).toContain('ORDER BY [t].[ID]')
  })

  it.each([
    ['CLIFOR', 'ORDER BY [t].[PRECOD], [t].[COD]'],
    ['AUTOMEZZI', 'ORDER BY [t].[PRECOD], [t].[COD]'],
    ['XRENTRIFORMULARI', 'ORDER BY [t].[CODICEFISCALE], [t].[NUMEROFIR]'],
    ['XRENTRIFIRTRASMESSI', 'ORDER BY [t].[IDRENTRI]'],
    ['ADDEBCON', 'ORDER BY [t].[COD]'],
  ])('%s e ordinata per chiave (estrazione ripetibile)', (tabella, atteso) => {
    expect(costruisciSelect(tabella, colonneDi(tabella))).toContain(atteso)
  })

  it('ogni tabella del catalogo ha un ordinamento', () => {
    for (const t of TABELLE_DOCUMENTATE) {
      expect(costruisciSelect(t.nome, colonneDi(t.nome))).toContain('ORDER BY')
    }
  })
})

describe('estraiStaging: catalogo esteso', () => {
  let radice: string
  beforeEach(async () => {
    radice = await mkdtemp(join(tmpdir(), 'estrazione-test-'))
  })
  afterEach(async () => {
    await rm(radice, { recursive: true, force: true })
  })

  /** Sorgente sintetica con TUTTE le tabelle del database principale, una riga ciascuna. */
  function sorgenteSintetica(): SorgenteSql & { select: string[] } {
    const select: string[] = []
    const colonneReali = (t: string): ColonnaSql[] => {
      const base = colonneDi(t)
      return t === 'RENesportazioni' ? [...base, { nome: 'DOCUMENTO', tipo: 'text' }] : base
    }
    return {
      database: 'WW00012026',
      select,
      permessiEffettivi: async () => ['SELECT'],
      elencaColonne: async t => colonneReali(t),
      leggiRighe: sql => {
        select.push(sql)
        const n = (sql.split(' FROM ')[0].match(/ AS \[/g) ?? []).length
        return (async function* () {
          yield Array.from({ length: n }, (_, i) => `v${i}`)
        })()
      },
    }
  }

  it('estrae le 17 tabelle nuove, salta MUDAZ/MUDTERZI e non legge DOCUMENTO', async () => {
    const sorgente = sorgenteSintetica()
    const { manifest, tabelleAssenti } = await estraiStaging(sorgente, radice)
    expect(tabelleAssenti).toEqual([])
    expect(Object.keys(manifest.tabelle)).toHaveLength(7 + 17)
    expect(Object.keys(manifest.tabelle)).not.toContain('MUDAZ')
    expect(Object.keys(manifest.tabelle)).not.toContain('MUDTERZI')
    expect(manifest.tabelle.RENesportazioni.colonne).not.toContain('DOCUMENTO')
    expect(sorgente.select.filter(s => s.includes('DOCUMENTO'))).toEqual([])
    for (const sql of sorgente.select) {
      expect(sql.startsWith('SELECT ')).toBe(true)
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|TRUNCATE)\b/i)
    }
    const staging = await apriStaging(
      manifest.databaseOrigine ? join(radice, manifest.databaseOrigine) : radice
    )
    expect(staging.avvisi).toEqual([])
  })
})

describe('redigiRiga', () => {
  const colonne = colonneDi('VERSIS')
  const riga = (cod: string) => [cod, 'id', '1', '1', 'host', 'utente', 'pwd', 'licenza', '1']
  const vuota = (cod: string) => [cod, 'id', '1', '1', '', '', '', '', '']
  it.each([
    'HUBRW:X90000',
    'HUBRP:X90000',
    'HUBRD:X90000',
    'HUBWWX90000',
    'firmarentri',
    'XRENTRI:0002',
    'INVENTATO:1',
    '',
  ])('svuota C1..C5 della riga con COD %p', cod => {
    expect(redigiRiga('VERSIS', colonne, riga(cod))).toEqual(vuota(cod))
  })
  it('svuota C1..C5 anche senza colonna COD; non tocca le altre tabelle', () => {
    expect(redigiRiga('VERSIS', [{ nome: 'C3', tipo: 'varchar' }], ['x'])).toEqual([''])
    expect(redigiRiga('MOVIMENTI', colonne, riga('HUBRW'))).toEqual(riga('HUBRW'))
  })
})

describe('estraiStaging', () => {
  let radice: string
  beforeEach(async () => {
    radice = await mkdtemp(join(tmpdir(), 'estrazione-test-'))
  })
  afterEach(async () => {
    await rm(radice, { recursive: true, force: true })
  })

  it('produce uno staging identico alla fixture (salvo manifest e segreti di VERSIS), valido per lettore e analizzatore', async () => {
    const sorgente = await sorgenteDaFixture()
    const { cartella, manifest, tabelleAssenti } = await estraiStaging(sorgente, radice, {
      estrattoIl: '2026-11-14T00:00:00.000Z',
    })
    expect(tabelleAssenti).toEqual(
      TABELLE_DOCUMENTATE.filter(
        t => t.database !== 'MUD' && !TABELLE_FIXTURE.includes(t.nome)
      ).map(t => t.nome)
    )
    expect(manifest.estrattore).toEqual({ nome: 'import-winwaste', versione: '1' })
    for (const file of [
      'movimenti',
      'formulari',
      'giacenze-rifiuti',
      'causali-rifiuti',
      'registri-rifiuti',
      'renregistrazioni',
    ]) {
      expect(
        (await readFile(join(cartella, `${file}.jsonl`))).equals(
          await readFile(join(FIXTURE, `${file}.jsonl`))
        )
      ).toBe(true)
    }
    const versis = (await readFile(join(cartella, 'versis.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(l => JSON.parse(l))
    expect(versis[2]).toEqual(['HUBRW:X90000', '', '1', '', '', '', '', '', ''])
    expect(JSON.stringify(versis)).not.toContain('PASSWORD-CIFRATA-FINTA')

    const staging = await apriStaging(cartella)
    expect(staging.avvisi).toEqual([])
    const rapporto = JSON.parse(JSON.stringify(await analizzaArchivio(staging)))
    const atteso = JSON.parse(await readFile(join(FIXTURE, 'rapporto-atteso.json'), 'utf8'))
    delete rapporto.hashManifest
    delete atteso.hashManifest
    expect(rapporto).toEqual(atteso)
  })

  it('rifiuta una cartella di destinazione non vuota; con svuota la ripulisce', async () => {
    const sorgente = await sorgenteDaFixture()
    const { cartella } = await estraiStaging(sorgente, radice)
    await writeFile(join(cartella, 'avanzo.jsonl'), 'x')
    await expect(estraiStaging(await sorgenteDaFixture(), radice)).rejects.toThrow(
      /CARTELLA_NON_VUOTA/
    )
    await estraiStaging(await sorgenteDaFixture(), radice, { svuota: true })
    expect(await readdir(cartella)).not.toContain('avanzo.jsonl')
  })

  it("l'origine nel manifest: versione, collation e impronta dello schema", async () => {
    const base = await sorgenteDaFixture()
    const sorgente: SorgenteSql = {
      ...base,
      infoOrigine: async () => ({
        versioneSqlServer: '16.0.4135.4',
        collation: 'Latin1_General_CI_AS',
      }),
    }
    const { manifest } = await estraiStaging(sorgente, radice)
    expect(manifest.origine).toMatchObject({
      versioneSqlServer: '16.0.4135.4',
      collation: 'Latin1_General_CI_AS',
    })
    expect(manifest.origine?.improntaSchema).toMatch(/^[0-9a-f]{64}$/)
    // Senza infoOrigine resta l'impronta; con lo stesso schema e' identica.
    const { manifest: m2 } = await estraiStaging(await sorgenteDaFixture(), join(radice, 'b'))
    expect(m2.origine?.versioneSqlServer).toBeUndefined()
    expect(m2.origine?.improntaSchema).toBe(manifest.origine?.improntaSchema)
    // Una colonna in piu' o un tipo diverso cambia l'impronta.
    const colonne = colonneDi('VERSIS')
    const piu = [...colonne, { nome: 'NUOVA', tipo: 'varchar' }]
    const tipoDiverso = colonne.map((c, i) => (i === 0 ? { ...c, tipo: 'int' } : c))
    const imp = (cc: ColonnaSql[]): string => improntaSchema([{ tabella: 'VERSIS', colonne: cc }])
    expect(imp(piu)).not.toBe(imp(colonne))
    expect(imp(tipoDiverso)).not.toBe(imp(colonne))
    expect(imp(colonne)).toBe(imp([...colonne]))
  })

  it('legge solo con SELECT (nessuna scrittura nelle query inviate)', async () => {
    const sorgente = await sorgenteDaFixture()
    await estraiStaging(sorgente, radice)
    expect(sorgente.select).toHaveLength(7)
    for (const sql of sorgente.select) {
      expect(sql.startsWith('SELECT ')).toBe(true)
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|TRUNCATE)\b/i)
    }
  })

  it('rifiuta un login con permessi di scrittura, senza leggere nulla', async () => {
    const sorgente = await sorgenteDaFixture(['SELECT', 'INSERT', 'CONNECT', 'ALTER'])
    await expect(estraiStaging(sorgente, radice)).rejects.toMatchObject({
      codice: 'LOGIN_CON_SCRITTURA',
    })
    await expect(estraiStaging(sorgente, radice)).rejects.toThrow(/ALTER, INSERT/)
    expect(sorgente.select).toEqual([])
  })

  it('rifiuta un database che non si chiama WW<ditta><anno>', async () => {
    const sorgente = { ...(await sorgenteDaFixture()), database: 'master' }
    await expect(estraiStaging(sorgente, radice)).rejects.toMatchObject({
      codice: 'DATABASE_NON_VALIDO',
    })
  })

  it('salta le tabelle assenti e le riporta; senza alcuna tabella fallisce', async () => {
    const parziale = await sorgenteDaFixture(['SELECT'], ['VERSIS', 'RENregistrazioni'])
    const { manifest, tabelleAssenti } = await estraiStaging(parziale, radice)
    expect(tabelleAssenti.slice(0, 2)).toEqual(['VERSIS', 'RENregistrazioni'])
    expect(Object.keys(manifest.tabelle)).not.toContain('VERSIS')
    const nessuna = { ...(await sorgenteDaFixture()), elencaColonne: async () => [] }
    await expect(estraiStaging(nessuna, join(radice, 'x'))).rejects.toMatchObject({
      codice: 'NESSUNA_TABELLA',
    })
  })
})
