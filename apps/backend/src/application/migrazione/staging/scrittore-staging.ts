import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { once } from 'events'
import { tabellaDocumentata } from './colonne-documentate'
import { FORMATO_STAGING, ManifestStaging, ManifestTabella } from './manifest'

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
  const out = createWriteStream(percorso)
  let righe = 0
  for await (const valori of tab.righe as AsyncIterable<readonly (string | null)[]>) {
    if (valori.length !== tab.colonne.length) {
      out.destroy()
      throw new Error(
        `tabella ${tab.nome}: riga ${righe + 1} con ${valori.length} valori, attese ${tab.colonne.length}`
      )
    }
    const linea = `${serializzaRiga(valori)}\n`
    hash.update(linea, 'utf8')
    righe++
    if (!out.write(linea, 'utf8')) await once(out, 'drain')
  }
  out.end()
  await once(out, 'finish')
  return { righe, sha256: hash.digest('hex') }
}

/** Scrive la cartella di staging (`<radice>/WW<ditta><anno>/`) e restituisce il manifest. */
export async function scriviStaging(
  radice: string,
  meta: MetaStaging,
  tabelle: readonly TabellaDaScrivere[]
): Promise<{ cartella: string; manifest: ManifestStaging }> {
  const databaseOrigine = `WW${meta.ditta}${meta.anno}`
  const cartella = join(radice, databaseOrigine)
  await mkdir(cartella, { recursive: true })
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
    tabelle: manifestTabelle,
  }
  await writeFile(join(cartella, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { cartella, manifest }
}
