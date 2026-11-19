import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { chmod, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { once } from 'events'
import {
  AmbitoPacchetto,
  FilePacchetto,
  FORMATO_PACCHETTO,
  IMPORT_SOURCE_WINWASTE,
  ManifestPacchetto,
  NOME_MANIFEST,
  NOME_MAPPA,
  nomeFilePacchetto,
} from './manifest-pacchetto'
import { improntaMappa, MappaImport, serializzaCanonico } from './mappa-import'

export interface FaseDaScrivere {
  readonly ambito: AmbitoPacchetto
  readonly fase: string
  readonly record: AsyncIterable<object> | Iterable<object>
}

export interface RichiestaScrittura {
  /** Cartella del pacchetto: deve chiamarsi come l'archivio (`WW<ditta><anno>`). */
  readonly cartella: string
  readonly archivio: string
  readonly hashStaging: string
  readonly mappa: MappaImport
  readonly fasi: readonly FaseDaScrivere[]
  readonly creatoIl?: string
}

/** U+2028/U+2029 spezzerebbero la riga per `readline`: vanno escapati. */
export function serializzaRecord(record: object): string {
  return JSON.stringify(record)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

async function scriviFase(percorso: string, record: FaseDaScrivere['record']): Promise<{ righe: number; sha256: string }> {
  const hash = createHash('sha256')
  const out = createWriteStream(percorso, { mode: 0o600 })
  let righe = 0
  try {
    for await (const r of record) {
      const linea = `${serializzaRecord(r)}\n`
      hash.update(linea)
      if (!out.write(linea)) await once(out, 'drain')
      righe++
    }
  } finally {
    out.end()
    await once(out, 'close')
  }
  await chmod(percorso, 0o600)
  return { righe, sha256: hash.digest('hex') }
}

/** Scrive il pacchetto (file 0600) e restituisce il manifest. Il manifest e' l'ultimo file scritto. */
export async function scriviPacchetto(r: RichiestaScrittura): Promise<ManifestPacchetto> {
  await mkdir(r.cartella, { recursive: true, mode: 0o700 })
  await writeFile(join(r.cartella, NOME_MAPPA), `${serializzaCanonico(r.mappa)}\n`, { mode: 0o600 })
  const file: FilePacchetto[] = []
  for (const f of r.fasi) {
    const nome = nomeFilePacchetto(f.ambito, f.fase)
    const esito = await scriviFase(join(r.cartella, nome), f.record)
    file.push({ ambito: f.ambito, fase: f.fase, file: nome, ...esito })
  }
  const manifest: ManifestPacchetto = {
    formato: FORMATO_PACCHETTO,
    importSource: IMPORT_SOURCE_WINWASTE,
    archivio: r.archivio,
    hashStaging: r.hashStaging,
    hashMappa: improntaMappa(r.mappa),
    creatoIl: r.creatoIl ?? new Date().toISOString(),
    file,
  }
  await writeFile(join(r.cartella, NOME_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return manifest
}
