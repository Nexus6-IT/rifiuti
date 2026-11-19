import { readFileSync } from 'fs'
import { join } from 'path'
import { TABELLE_DOCUMENTATE, tabellaDocumentata } from './colonne-documentate'

/**
 * Catalogo del database modello `ww00002014` (sys.columns, ordine di column_id), ricavato da
 * `docs/schema-db-winwaste.md` §6. Il test opt-in `WASTEFLOW_TEST_MSSQL=1` di
 * `tools/import-winwaste` lo ricontrolla contro un SQL Server vero.
 */
type CatalogoModello = Record<string, { nome: string; tipoSql: string }[]>
const MODELLO: CatalogoModello = JSON.parse(
  readFileSync(join(__dirname, '../../../../test/fixtures/winwaste/catalogo-modello.json'), 'utf8')
)

const NUOVE = [
  'CLIFOR',
  'SEDI LEGALI',
  'UNITA LOCALI',
  'AUTORIZZAZIONI',
  'AUTOMEZZI',
  'AUTISTI',
  'MAGAZZINI RIFIUTI',
  'NUMERAZIONI',
  'RENrelazioniIniziali',
  'RENesportazioni',
  'XRENTRIFORMULARI',
  'XRENTRIFIRTRASMESSI',
  'CONTRATTI',
  'ELENCHIADDEB',
  'ADDEBCON',
  'ADDEBITI',
  'CONDIZIONI DI PAGAMENTO',
]

describe('catalogo esteso (I1)', () => {
  it.each(NUOVE)('%s: colonne e ordine uguali al catalogo del modello', nome => {
    const t = tabellaDocumentata(nome)
    expect(t).toBeDefined()
    const attese = MODELLO[nome].filter(c => !(t?.escluse ?? []).includes(c.nome))
    expect(t!.colonne.map(c => [c.nome, c.tipoSql])).toEqual(attese.map(c => [c.nome, c.tipoSql]))
  })

  it('le tabelle del blocco 1 restano al loro posto, davanti alle nuove', () => {
    expect(TABELLE_DOCUMENTATE.slice(0, 7).map(t => t.nome)).toEqual([
      'MOVIMENTI',
      'FORMULARI',
      'GIACENZE RIFIUTI',
      'CAUSALI RIFIUTI',
      'REGISTRI RIFIUTI',
      'VERSIS',
      'RENregistrazioni',
    ])
  })

  it('RENesportazioni: DOCUMENTO (file XML inviato) non entra nel catalogo', () => {
    const t = tabellaDocumentata('RENesportazioni')!
    expect(t.escluse).toEqual(['DOCUMENTO'])
    expect(t.colonne.map(c => c.nome)).not.toContain('DOCUMENTO')
  })

  it('MUDAZ e MUDTERZI sono del database MUD, con le 53 colonne documentate', () => {
    for (const nome of ['MUDAZ', 'MUDTERZI']) {
      const t = tabellaDocumentata(nome)!
      expect(t.database).toBe('MUD')
      expect(t.colonne).toHaveLength(7 + 46)
      expect(t.colonne[0].nome).toBe('COD')
      expect(t.colonne[t.colonne.length - 1].nome).toBe('M46')
    }
  })

  it('nomi di tabella e di file sono unici e i file rispettano il formato del manifest', () => {
    expect(new Set(TABELLE_DOCUMENTATE.map(t => t.nome)).size).toBe(TABELLE_DOCUMENTATE.length)
    expect(new Set(TABELLE_DOCUMENTATE.map(t => t.file)).size).toBe(TABELLE_DOCUMENTATE.length)
    for (const t of TABELLE_DOCUMENTATE) expect(t.file).toMatch(/^[a-z0-9][a-z0-9-]*\.jsonl$/)
  })

  it('nessuna tabella ha colonne ripetute', () => {
    for (const t of TABELLE_DOCUMENTATE) {
      expect(new Set(t.colonne.map(c => c.nome)).size).toBe(t.colonne.length)
    }
  })
})
