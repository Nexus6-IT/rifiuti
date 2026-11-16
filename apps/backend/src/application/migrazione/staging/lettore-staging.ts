import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { readFile, stat } from 'fs/promises'
import { basename, join, resolve } from 'path'
import { createInterface } from 'readline'
import { tabellaDocumentata } from './colonne-documentate'
import { ManifestStaging, ManifestTabella, StagingError, validaManifest } from './manifest'

/**
 * Lettore dello staging WinWaste.
 *
 * Contratto:
 *  - `apriStaging` valida il manifest e verifica OGNI file (esistenza, SHA-256,
 *    numero di righe) prima di restituire qualcosa: un archivio manomesso o
 *    troncato non arriva mai alla decodifica.
 *  - `leggi` legge in streaming (memoria costante) e restituisce i valori come
 *    stringhe o `null`, esattamente come li ha scritti l'estrattore. Una riga
 *    illeggibile diventa uno scarto con il numero di riga e la lettura prosegue.
 *  - Le differenze di colonne rispetto a quelle documentate sono AVVISI, non
 *    errori: le versioni di WinWaste cambiano lo schema.
 */

export type CodiceAvvisoStaging =
  | 'COLONNA_MANCANTE'
  | 'COLONNA_NON_DOCUMENTATA'
  | 'TABELLA_NON_DOCUMENTATA'

export interface AvvisoStaging {
  readonly codice: CodiceAvvisoStaging
  readonly tabella: string
  readonly colonna?: string
}

export type CodiceScartoLettura =
  | 'RIGA_JSON_MALFORMATA'
  | 'RIGA_NON_ARRAY'
  | 'RIGA_LUNGHEZZA'
  | 'VALORE_NON_STRINGA'

export interface RigaGrezza {
  /** Numero di riga fisica nel file (da 1). */
  readonly numeroRiga: number
  /** Valori per nome di colonna: stringa oppure `null` (NULL di SQL Server). */
  readonly campi: Readonly<Record<string, string | null>>
}

export interface ScartoLettura {
  readonly numeroRiga: number
  readonly codice: CodiceScartoLettura
}

export type ElementoLettura =
  | { readonly tipo: 'riga'; readonly riga: RigaGrezza }
  | { readonly tipo: 'scarto'; readonly scarto: ScartoLettura }

export interface StagingAperto {
  readonly cartella: string
  /** Nome della cartella = database d'origine (`WW00012026`). */
  readonly archivio: string
  readonly manifest: ManifestStaging
  /** SHA-256 del `manifest.json` (finisce in `lotti_import.hash_staging`). */
  readonly hashManifest: string
  readonly avvisi: readonly AvvisoStaging[]
  /** Tabelle presenti nel manifest. */
  tabelle(): string[]
  ha(tabella: string): boolean
  /** Colonne dichiarate dal manifest per la tabella. */
  colonne(tabella: string): readonly string[]
  leggi(tabella: string): AsyncGenerator<ElementoLettura>
}

interface Verifica {
  readonly sha256: string
  readonly righe: number
}

async function verificaFile(percorso: string): Promise<Verifica> {
  const hash = createHash('sha256')
  const stream = createReadStream(percorso)
  stream.on('data', chunk => hash.update(chunk))
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let righe = 0
  for await (const linea of rl) {
    if (linea.trim().length > 0) righe++
  }
  return { sha256: hash.digest('hex'), righe }
}

function avvisiColonne(nome: string, tab: ManifestTabella): AvvisoStaging[] {
  const doc = tabellaDocumentata(nome)
  if (!doc) return [{ codice: 'TABELLA_NON_DOCUMENTATA', tabella: nome }]
  const documentate = new Set(doc.colonne.map(c => c.nome))
  const dichiarate = new Set(tab.colonne)
  const avvisi: AvvisoStaging[] = []
  for (const c of doc.colonne) {
    if (!dichiarate.has(c.nome)) {
      avvisi.push({ codice: 'COLONNA_MANCANTE', tabella: nome, colonna: c.nome })
    }
  }
  for (const c of tab.colonne) {
    if (!documentate.has(c)) {
      avvisi.push({ codice: 'COLONNA_NON_DOCUMENTATA', tabella: nome, colonna: c })
    }
  }
  return avvisi
}

export async function apriStaging(cartella: string): Promise<StagingAperto> {
  const radice = resolve(cartella)
  let info
  try {
    info = await stat(radice)
  } catch {
    throw new StagingError('CARTELLA_NON_VALIDA', 'la cartella non esiste')
  }
  if (!info.isDirectory()) throw new StagingError('CARTELLA_NON_VALIDA', 'non e una cartella')

  let grezzo: Buffer
  try {
    grezzo = await readFile(join(radice, 'manifest.json'))
  } catch {
    throw new StagingError('MANIFEST_ASSENTE', 'manifest.json non trovato')
  }
  let json: unknown
  try {
    json = JSON.parse(grezzo.toString('utf8'))
  } catch {
    throw new StagingError('MANIFEST_NON_VALIDO', 'manifest.json non e JSON valido')
  }
  const archivio = basename(radice)
  const manifest = validaManifest(json, archivio)
  const hashManifest = createHash('sha256').update(grezzo).digest('hex')

  const avvisi: AvvisoStaging[] = []
  for (const nome of Object.keys(manifest.tabelle)) {
    const tab = manifest.tabelle[nome]
    const percorso = join(radice, tab.file)
    try {
      await stat(percorso)
    } catch {
      throw new StagingError('FILE_ASSENTE', `${tab.file} (tabella ${nome})`)
    }
    const v = await verificaFile(percorso)
    if (v.sha256 !== tab.sha256) {
      throw new StagingError('HASH_NON_CORRISPONDE', `${tab.file} (tabella ${nome})`)
    }
    if (v.righe !== tab.righe) {
      throw new StagingError(
        'RIGHE_NON_CORRISPONDENTI',
        `${tab.file}: dichiarate ${tab.righe}, lette ${v.righe}`
      )
    }
    avvisi.push(...avvisiColonne(nome, tab))
  }

  async function* leggi(tabella: string): AsyncGenerator<ElementoLettura> {
    const tab = manifest.tabelle[tabella]
    if (!tab) throw new StagingError('FILE_ASSENTE', `tabella ${tabella} non presente nel manifest`)
    const colonne = tab.colonne
    const rl = createInterface({
      input: createReadStream(join(radice, tab.file)),
      crlfDelay: Infinity,
    })
    let numeroRiga = 0
    for await (const linea of rl) {
      numeroRiga++
      if (linea.trim().length === 0) continue
      let valori: unknown
      try {
        valori = JSON.parse(linea)
      } catch {
        yield { tipo: 'scarto', scarto: { numeroRiga, codice: 'RIGA_JSON_MALFORMATA' } }
        continue
      }
      if (!Array.isArray(valori)) {
        yield { tipo: 'scarto', scarto: { numeroRiga, codice: 'RIGA_NON_ARRAY' } }
        continue
      }
      if (valori.length !== colonne.length) {
        yield { tipo: 'scarto', scarto: { numeroRiga, codice: 'RIGA_LUNGHEZZA' } }
        continue
      }
      if (valori.some(v => v !== null && typeof v !== 'string')) {
        yield { tipo: 'scarto', scarto: { numeroRiga, codice: 'VALORE_NON_STRINGA' } }
        continue
      }
      const campi: Record<string, string | null> = {}
      for (let i = 0; i < colonne.length; i++) campi[colonne[i]] = valori[i] as string | null
      yield { tipo: 'riga', riga: { numeroRiga, campi } }
    }
  }

  return {
    cartella: radice,
    archivio,
    manifest,
    hashManifest,
    avvisi,
    tabelle: () => Object.keys(manifest.tabelle),
    ha: t => Object.prototype.hasOwnProperty.call(manifest.tabelle, t),
    colonne: t => manifest.tabelle[t]?.colonne ?? [],
    leggi,
  }
}
