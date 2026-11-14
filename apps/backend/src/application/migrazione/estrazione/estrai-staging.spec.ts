import { mkdtemp, readFile, rm } from 'fs/promises'
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
    elencaColonne: async t => (tabelleAssenti.includes(t) ? [] : colonneDi(t)),
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

  it('VERSIS: i segreti sono oscurati dalla query stessa', () => {
    const sql = costruisciSelect('VERSIS', colonneDi('VERSIS'))
    expect(sql).toContain(
      "CASE WHEN [t].[COD] LIKE N'HUBRW%' OR [t].[COD] LIKE N'FIRMARENTRI%' THEN N'' ELSE CAST([t].[C3] AS NVARCHAR(MAX)) END AS [C3]"
    )
    expect(sql).not.toContain(
      "CASE WHEN [t].[COD] LIKE N'HUBRW%' OR [t].[COD] LIKE N'FIRMARENTRI%' THEN N'' ELSE CAST([t].[IDSIS]"
    )
  })

  it('VERSIS senza colonna COD: nessun CASE (la riga non e riconoscibile, ci pensa il parser)', () => {
    expect(costruisciSelect('VERSIS', [{ nome: 'C3', tipo: 'varchar' }])).not.toContain('CASE')
  })
})

describe('redigiRiga', () => {
  const colonne = colonneDi('VERSIS')
  const riga = (cod: string) => [cod, 'id', '1', '1', 'host', 'utente', 'pwd', 'licenza', '1']
  it('svuota C1..C5 delle righe HUBRW e FIRMARENTRI', () => {
    expect(redigiRiga('VERSIS', colonne, riga('HUBRW:X90000'))).toEqual([
      'HUBRW:X90000',
      'id',
      '1',
      '1',
      '',
      '',
      '',
      '',
      '',
    ])
    expect(redigiRiga('VERSIS', colonne, riga('firmarentri'))[6]).toBe('')
  })
  it('lascia intatte le altre righe e le altre tabelle', () => {
    expect(redigiRiga('VERSIS', colonne, riga('XRENTRI:0002'))).toEqual(riga('XRENTRI:0002'))
    expect(redigiRiga('MOVIMENTI', colonne, riga('HUBRW'))).toEqual(riga('HUBRW'))
    expect(redigiRiga('VERSIS', [{ nome: 'C3', tipo: 'varchar' }], ['x'])).toEqual(['x'])
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
    expect(tabelleAssenti).toEqual([])
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
    expect(tabelleAssenti).toEqual(['VERSIS', 'RENregistrazioni'])
    expect(Object.keys(manifest.tabelle)).not.toContain('VERSIS')
    const nessuna = { ...(await sorgenteDaFixture()), elencaColonne: async () => [] }
    await expect(estraiStaging(nessuna, join(radice, 'x'))).rejects.toMatchObject({
      codice: 'NESSUNA_TABELLA',
    })
  })
})
