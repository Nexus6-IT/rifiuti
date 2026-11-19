import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { chmod, mkdir, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { once } from 'events'
import { tabellaDocumentata } from './colonne-documentate'
import { FORMATO_STAGING, ManifestStaging, ManifestTabella, OrigineStaging } from './manifest'

/**
 * Scrittore dello staging `winwaste-staging/1`: l'unico punto che sa come si
 * serializza una riga. Lo usano l'estrattore da SQL Server e il generatore
 * delle fixture, cosi' il formato e' definito una volta sola.
 *
 * Ogni riga e' un array JSON di stringhe o `null` (NULL di SQL Server)
 * nell'ordine delle colonne del manifest, su una riga di testo (a capo e
 * tabulazioni dentro un valore sono escapati da JSON). UTF-8, a capo `\n`.
 */

export interface TabellaDaScrivere {
  /** Nome SQL Server esatto. */
  readonly nome: string
  readonly colonne: readonly string[]
  readonly righe: AsyncIterable<readonly (string | null)[]> | Iterable<readonly (string | null)[]>
  /** Nome del file; se omesso, quello documentato o il nome della tabella normalizzato. */
  readonly file?: string
}

export interface MetaStaging {
  readonly ditta: string
  readonly anno: number
  readonly estrattoIl: string
  readonly estrattore?: { readonly nome: string; readonly versione: string }
  readonly origine?: OrigineStaging
}

export function nomeFileTabella(nome: string): string {
  const doc = tabellaDocumentata(nome)
  if (doc) return doc.file
  return `${nome
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}.jsonl`
}

/**
 * U+2028 e U+2029 sono validi dentro una stringa JSON ma `readline` li tratta
 * come fine riga: vanno escapati, altrimenti spezzerebbero la riga in lettura.
 */
export function serializzaRiga(valori: readonly (string | null)[]): string {
  return JSON.stringify(valori)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

async function scriviFile(
  percorso: string,
  tab: TabellaDaScrivere
): Promise<Pick<ManifestTabella, 'righe' | 'sha256'>> {
  const hash = createHash('sha256')
  const out = createWriteStream(percorso, { mode: 0o600 })
  // Un errore di scrittura (disco pieno) emesso fuori da un `once` non deve far crashare il processo.
  let erroreScrittura: Error | undefined
  out.on('error', e => {
    erroreScrittura = e
  })
  let righe = 0
  for await (const valori of tab.righe as AsyncIterable<readonly (string | null)[]>) {
    if (valori.length !== tab.colonne.length) {
      out.destroy()
      throw new Error(
        `tabella ${tab.nome}: riga ${righe + 1} con ${valori.length} valori, attese ${tab.colonne.length}`
      )
    }
    if (erroreScrittura) throw erroreScrittura
    const linea = `${serializzaRiga(valori)}\n`
    hash.update(linea, 'utf8')
    righe++
    if (!out.write(linea, 'utf8')) await once(out, 'drain')
  }
  if (erroreScrittura) throw erroreScrittura
  out.end()
  await once(out, 'finish')
  await chmod(percorso, 0o600)
  return { righe, sha256: hash.digest('hex') }
}

export interface OpzioniScrittura {
  /** Svuota una cartella di destinazione non vuota invece di rifiutarla. */
  readonly svuota?: boolean
}

export class ScritturaStagingError extends Error {
  constructor(
    readonly codice: 'CARTELLA_NON_VUOTA',
    dettaglio: string
  ) {
    super(`${codice}: ${dettaglio}`)
    this.name = 'ScritturaStagingError'
  }
}

/**
 * Scrive la cartella di staging (`<radice>/WW<ditta><anno>/`, permessi 0700,
 * file 0600: contiene dati personali in chiaro) e restituisce il manifest.
 * Una cartella di destinazione non vuota e' rifiutata (`CARTELLA_NON_VUOTA`):
 * file di un'estrazione precedente non piu' elencati nel manifest resterebbero
 * sul disco; con `svuota` vengono rimossi prima.
 */
export async function scriviStaging(
  radice: string,
  meta: MetaStaging,
  tabelle: readonly TabellaDaScrivere[],
  opzioni: OpzioniScrittura = {}
): Promise<{ cartella: string; manifest: ManifestStaging }> {
  const databaseOrigine = `WW${meta.ditta}${meta.anno}`
  const cartella = join(radice, databaseOrigine)
  await mkdir(cartella, { recursive: true, mode: 0o700 })
  await chmod(cartella, 0o700)
  const presenti = await readdir(cartella)
  if (presenti.length > 0) {
    if (!opzioni.svuota) {
      throw new ScritturaStagingError(
        'CARTELLA_NON_VUOTA',
        `${cartella} contiene gia ${presenti.length} elementi: usare una cartella nuova o --forza per svuotarla`
      )
    }
    for (const f of presenti) await rm(join(cartella, f), { recursive: true, force: true })
  }
  const manifestTabelle: Record<string, ManifestTabella> = {}
  for (const tab of tabelle) {
    const file = tab.file ?? nomeFileTabella(tab.nome)
    const esito = await scriviFile(join(cartella, file), tab)
    manifestTabelle[tab.nome] = { file, colonne: [...tab.colonne], ...esito }
  }
  const manifest: ManifestStaging = {
    formato: FORMATO_STAGING,
    ditta: meta.ditta,
    anno: meta.anno,
    databaseOrigine,
    estrattoIl: meta.estrattoIl,
    ...(meta.estrattore ? { estrattore: meta.estrattore } : {}),
    ...(meta.origine ? { origine: meta.origine } : {}),
    tabelle: manifestTabelle,
  }
  await writeFile(join(cartella, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return { cartella, manifest }
}
