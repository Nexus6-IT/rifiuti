import { createHash } from 'crypto'
import { tabellaDocumentata, TABELLE_DOCUMENTATE } from '../staging/colonne-documentate'
import { ManifestStaging, PATTERN_ARCHIVIO } from '../staging/manifest'
import { scriviStaging, TabellaDaScrivere } from '../staging/scrittore-staging'

/**
 * Estrazione da SQL Server verso lo staging `winwaste-staging/1`.
 *
 * Questo modulo e' il NUCLEO senza dipendenze (nessun driver SQL Server): sa
 * costruire le query di lettura, ridurre ogni valore a stringa o `null`,
 * rifiutare un login che puo' scrivere, oscurare i segreti e scrivere lo
 * staging. Il driver (`mssql`) sta SOLO nel tool `tools/import-winwaste`, che
 * implementa `SorgenteSql`; il nucleo si prova sempre con una sorgente finta.
 *
 * Regole:
 *  - il login deve essere di sola lettura: se fra `permessiEffettivi()` ce n'e'
 *    anche uno di scrittura, l'estrazione non parte (`LOGIN_CON_SCRITTURA`);
 *  - si leggono SOLO le tabelle del catalogo documentato (nomi mai presi
 *    dall'input) e SOLO con `SELECT`;
 *  - ogni colonna e' convertita in testo dal server (`CAST` a `NVARCHAR`):
 *    nessun valore passa da numeri JavaScript e la codifica del testo non
 *    dipende dalla collation (`Latin1_General_CI_AS`) ne dal driver;
 *  - da `VERSIS` `C1..C5` non vengono letti per NESSUNA riga (nelle righe hub
 *    `HUBRW/HUBRP/HUBRD/HUBWW` contengono host, utente, password cifrata,
 *    licenza; un denylist di prefissi sarebbe fragile): la `SELECT` li
 *    sostituisce con stringa vuota gia' sul server e `redigiRiga` lo ripete in
 *    Node come seconda difesa, prima che arrivino al file.
 */
export type CodiceErroreEstrazione =
  | 'LOGIN_CON_SCRITTURA'
  | 'DATABASE_NON_VALIDO'
  | 'TIPO_NON_SUPPORTATO'
  | 'TABELLA_NON_AMMESSA'
  | 'NESSUNA_TABELLA'

export class EstrazioneError extends Error {
  constructor(
    readonly codice: CodiceErroreEstrazione,
    readonly dettaglio: string
  ) {
    super(`${codice}: ${dettaglio}`)
    this.name = 'EstrazioneError'
  }
}

export interface ColonnaSql {
  readonly nome: string
  /** Tipo SQL Server (`sys.types.name`), minuscolo: `varchar`, `int`, `decimal`, `text`... */
  readonly tipo: string
}

/** Informazioni sul server e sul database d'origine, per il manifest dello staging. */
export interface InfoOrigine {
  /** `SERVERPROPERTY('ProductVersion')`, es. `16.0.4135.4`. */
  readonly versioneSqlServer?: string
  /** Collation del database, es. `Latin1_General_CI_AS`. */
  readonly collation?: string
}

export interface SorgenteSql {
  /** Nome del database a cui il login e' connesso. */
  readonly database: string
  /** Tutti i permessi effettivi del login (database, server, tabelle): il nucleo isola quelli di scrittura. */
  permessiEffettivi(): Promise<string[]>
  /** Colonne della tabella nell'ordine di `column_id`; vuoto se la tabella non esiste. */
  elencaColonne(tabella: string): Promise<ColonnaSql[]>
  /** Esegue una `SELECT` e restituisce righe di stringhe o `null`, nell'ordine delle colonne. */
  leggiRighe(select: string): AsyncIterable<(string | null)[]>
  /** Versione di SQL Server e collation (facoltativo: assente nelle sorgenti finte). */
  infoOrigine?(): Promise<InfoOrigine>
}

/**
 * Impronta dello schema trovato: SHA-256 di `tabella|colonna|tipo` per ogni colonna estratta, nell'ordine
 * del catalogo. Due archivi con lo stesso schema danno la stessa impronta; una versione di WinWaste che
 * cambia le colonne la cambia.
 */
export function improntaSchema(
  schema: ReadonlyArray<{ tabella: string; colonne: readonly ColonnaSql[] }>
): string {
  const h = createHash('sha256')
  for (const { tabella, colonne } of schema) {
    for (const c of colonne) h.update(`${tabella}|${c.nome}|${c.tipo.toLowerCase()}\n`, 'utf8')
  }
  return h.digest('hex')
}

/** Permessi che un login di estrazione NON deve avere. */
export function eScrittura(permesso: string): boolean {
  const p = permesso.trim().toUpperCase()
  return (
    p === 'INSERT' ||
    p === 'UPDATE' ||
    p === 'DELETE' ||
    p.startsWith('CONTROL') ||
    p === 'TAKE OWNERSHIP' ||
    p.startsWith('ALTER') ||
    p.startsWith('CREATE')
  )
}

const quota = (nome: string): string => `[${nome.replace(/]/g, ']]')}]`

const TIPI_INTERI = new Set(['int', 'bigint', 'smallint', 'tinyint'])
const TIPI_DECIMALI = new Set(['decimal', 'numeric'])
const TIPI_VIRGOLA_MOBILE = new Set(['float', 'real'])
const TIPI_MONETARI = new Set(['money', 'smallmoney'])
const TIPI_TESTO = new Set(['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext', 'sysname'])
const TIPI_DATA = new Set([
  'date',
  'datetime',
  'datetime2',
  'smalldatetime',
  'datetimeoffset',
  'time',
])
const TIPI_BINARI = new Set(['binary', 'varbinary', 'image', 'timestamp', 'rowversion'])

/** Espressione di lettura di una colonna: sempre testo (o NULL), senza alias. */
export function espressioneColonna(alias: string, c: ColonnaSql): string {
  const col = `${quota(alias)}.${quota(c.nome)}`
  const t = c.tipo.toLowerCase()
  let espr: string
  if (TIPI_INTERI.has(t)) espr = `CAST(${col} AS NVARCHAR(40))`
  else if (TIPI_DECIMALI.has(t)) espr = `CAST(${col} AS NVARCHAR(64))`
  // CAST di float a testo darebbe 6 cifre in notazione scientifica e di money 2 decimali:
  // stile 3 = 17 cifre (round-trip esatto), stile 2 = 4 decimali senza separatori.
  else if (TIPI_VIRGOLA_MOBILE.has(t)) espr = `CONVERT(NVARCHAR(64), ${col}, 3)`
  else if (TIPI_MONETARI.has(t)) espr = `CONVERT(NVARCHAR(64), ${col}, 2)`
  else if (TIPI_TESTO.has(t)) espr = `CAST(${col} AS NVARCHAR(MAX))`
  else if (t === 'bit') espr = `CAST(${col} AS NVARCHAR(1))`
  else if (t === 'uniqueidentifier') espr = `CAST(${col} AS NVARCHAR(36))`
  else if (TIPI_DATA.has(t)) espr = `CONVERT(NVARCHAR(40), ${col}, 126)`
  else if (TIPI_BINARI.has(t)) espr = `CONVERT(VARCHAR(MAX), CAST(${col} AS VARBINARY(MAX)), 1)`
  else throw new EstrazioneError('TIPO_NON_SUPPORTATO', `${c.nome}: tipo ${c.tipo}`)
  return espr
}

const COLONNE_SEGRETE_VERSIS = new Set(['C1', 'C2', 'C3', 'C4', 'C5'])

/** Colonne di ordinamento (chiave primaria) per un'estrazione ripetibile. */
const ORDINAMENTO: Readonly<Record<string, readonly string[]>> = {
  MOVIMENTI: ['COD'],
  FORMULARI: ['COD'],
  'GIACENZE RIFIUTI': ['UL', 'MAG', 'POS', 'CER', 'SF', 'RIF'],
  'CAUSALI RIFIUTI': ['COD'],
  'REGISTRI RIFIUTI': ['COD'],
  VERSIS: ['COD'],
  RENregistrazioni: ['REGISTRO', 'PROTOCOLLO'],
  CLIFOR: ['PRECOD', 'COD'],
  'SEDI LEGALI': ['PRECOD', 'COD'],
  'UNITA LOCALI': ['PRECOD', 'COD'],
  AUTORIZZAZIONI: ['PRECOD', 'COD'],
  AUTOMEZZI: ['PRECOD', 'COD'],
  AUTISTI: ['PRECOD', 'COD'],
  'MAGAZZINI RIFIUTI': ['PRECOD', 'COD'],
  NUMERAZIONI: ['COD'],
  RENrelazioniIniziali: ['ID'],
  RENesportazioni: ['ID'],
  XRENTRIFORMULARI: ['CODICEFISCALE', 'NUMEROFIR'],
  XRENTRIFIRTRASMESSI: ['IDRENTRI'],
  CONTRATTI: ['PRECOD', 'COD'],
  ELENCHIADDEB: ['PRECOD', 'COD'],
  ADDEBCON: ['COD'],
  ADDEBITI: ['COD'],
  'CONDIZIONI DI PAGAMENTO': ['COD'],
  MUDAZ: ['COD'],
  MUDTERZI: ['COD'],
}

/**
 * `SELECT` di lettura di una tabella documentata. L'`ORDER BY` usa le colonne
 * originali qualificate (non gli alias testuali: `COD` va ordinato come
 * numero), cosi' due estrazioni dello stesso archivio producono file uguali.
 */
export function costruisciSelect(tabella: string, colonne: readonly ColonnaSql[]): string {
  if (!tabellaDocumentata(tabella)) {
    throw new EstrazioneError('TABELLA_NON_AMMESSA', 'tabella fuori dal catalogo documentato')
  }
  const alias = 't'
  const escluse = new Set(tabellaDocumentata(tabella)?.escluse ?? [])
  const lette = colonne.filter(c => !escluse.has(c.nome))
  const nomi = new Set(lette.map(c => c.nome))
  const elenco = lette
    .map(c => {
      // C1..C5 di VERSIS non si leggono MAI (allowlist: il parser non li usa):
      // la colonna esce vuota gia' dal server, per qualsiasi prefisso del COD.
      const espr =
        tabella === 'VERSIS' && COLONNE_SEGRETE_VERSIS.has(c.nome)
          ? "N''"
          : espressioneColonna(alias, c)
      return `${espr} AS ${quota(c.nome)}`
    })
    .join(', ')
  const ord = (ORDINAMENTO[tabella] ?? []).filter(c => nomi.has(c))
  const orderBy =
    ord.length > 0 ? ` ORDER BY ${ord.map(c => `${quota(alias)}.${quota(c)}`).join(', ')}` : ''
  return `SELECT ${elenco} FROM ${quota('dbo')}.${quota(tabella)} AS ${quota(alias)}${orderBy}`
}

/** Svuota `C1..C5` di `VERSIS` in ogni riga (seconda difesa); le altre tabelle restano com'e'. */
export function redigiRiga(
  tabella: string,
  colonne: readonly ColonnaSql[],
  valori: (string | null)[]
): (string | null)[] {
  if (tabella !== 'VERSIS') return valori
  return valori.map((v, i) => (COLONNE_SEGRETE_VERSIS.has(colonne[i].nome) ? '' : v))
}

export interface OpzioniEstrazione {
  readonly estrattoIl?: string
  readonly estrattore?: { readonly nome: string; readonly versione: string }
  /** Svuota la cartella di destinazione se non e' vuota (altrimenti `CARTELLA_NON_VUOTA`). */
  readonly svuota?: boolean
}

export interface EsitoEstrazione {
  readonly cartella: string
  readonly manifest: ManifestStaging
  /** Tabelle del catalogo assenti dal database sorgente. */
  readonly tabelleAssenti: readonly string[]
}

export async function estraiStaging(
  sorgente: SorgenteSql,
  radiceOut: string,
  opzioni: OpzioniEstrazione = {}
): Promise<EsitoEstrazione> {
  const m = PATTERN_ARCHIVIO.exec(sorgente.database)
  if (!m) {
    throw new EstrazioneError(
      'DATABASE_NON_VALIDO',
      'il database deve chiamarsi WW<ditta 4><anno 4>'
    )
  }
  const [, ditta, anno] = m
  const permessi = (await sorgente.permessiEffettivi()).filter(eScrittura)
  if (permessi.length > 0) {
    throw new EstrazioneError(
      'LOGIN_CON_SCRITTURA',
      `il login ha permessi di scrittura (${[...new Set(permessi)].sort().join(', ')}): usare un login di sola lettura`
    )
  }

  const tabelle: TabellaDaScrivere[] = []
  const assenti: string[] = []
  const schema: { tabella: string; colonne: ColonnaSql[] }[] = []
  for (const t of TABELLE_DOCUMENTATE) {
    // MUDAZ/MUDTERZI stanno nel database MUD (ww<azienda>MU<aa>), non in WW<ditta><anno>.
    if (t.database === 'MUD') continue
    const tutte = await sorgente.elencaColonne(t.nome)
    if (tutte.length === 0) {
      assenti.push(t.nome)
      continue
    }
    const escluse = new Set(t.escluse ?? [])
    const colonne = tutte.filter(c => !escluse.has(c.nome))
    schema.push({ tabella: t.nome, colonne })
    const select = costruisciSelect(t.nome, tutte)
    tabelle.push({
      nome: t.nome,
      colonne: colonne.map(c => c.nome),
      righe: (async function* () {
        for await (const valori of sorgente.leggiRighe(select))
          yield redigiRiga(t.nome, colonne, valori)
      })(),
    })
  }
  if (tabelle.length === 0) {
    throw new EstrazioneError(
      'NESSUNA_TABELLA',
      'nessuna tabella del catalogo trovata nel database'
    )
  }
  const info = sorgente.infoOrigine ? await sorgente.infoOrigine() : {}
  const { cartella, manifest } = await scriviStaging(
    radiceOut,
    {
      ditta,
      anno: Number(anno),
      estrattoIl: opzioni.estrattoIl ?? new Date().toISOString(),
      estrattore: opzioni.estrattore ?? { nome: 'import-winwaste', versione: '1' },
      origine: { ...info, improntaSchema: improntaSchema(schema) },
    },
    tabelle,
    { svuota: opzioni.svuota }
  )
  return { cartella, manifest, tabelleAssenti: assenti }
}
