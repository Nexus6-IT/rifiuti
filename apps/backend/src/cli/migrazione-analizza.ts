import { access, writeFile } from 'fs/promises'
import { join } from 'path'
import { analizzaArchivio } from '../application/migrazione/analisi/analizza-archivio'
import { rapportoInMarkdown } from '../application/migrazione/analisi/rapporto-sorgente'
import { apriStaging } from '../application/migrazione/staging/lettore-staging'
import { StagingError } from '../application/migrazione/staging/manifest'

/**
 * `npm run migrazione:analizza -- <cartella-staging> [--forza]`
 *
 * Legge lo staging WinWaste, lo decodifica e scrive accanto ad esso
 * `rapporto-sorgente.json` e `rapporto-sorgente.md`. NON apre il database,
 * non importa Prisma ne NestJS. Gli scarti non sono un errore di esecuzione.
 *
 * Codici di uscita: 0 ok; 1 rapporto gia esistente senza `--forza`; 2 staging
 * rifiutato (manifest, impronte, righe, colonne indispensabili); 64 uso errato.
 */
export interface UscitaCli {
  scrivi(messaggio: string): void
  errore(messaggio: string): void
}

const USO = 'uso: migrazione:analizza <cartella-staging> [--forza]'

async function esiste(percorso: string): Promise<boolean> {
  try {
    await access(percorso)
    return true
  } catch {
    return false
  }
}

export async function eseguiCli(argv: readonly string[], uscita: UscitaCli): Promise<number> {
  const forza = argv.includes('--forza')
  const posizionali = argv.filter(a => !a.startsWith('--'))
  const sconosciute = argv.filter(a => a.startsWith('--') && a !== '--forza')
  if (posizionali.length !== 1 || sconosciute.length > 0) {
    uscita.errore(USO)
    return 64
  }
  const cartella = posizionali[0]
  try {
    const staging = await apriStaging(cartella)
    const json = join(staging.cartella, 'rapporto-sorgente.json')
    const md = join(staging.cartella, 'rapporto-sorgente.md')
    if (!forza && ((await esiste(json)) || (await esiste(md)))) {
      uscita.errore('rapporto gia esistente: usa --forza per sovrascriverlo')
      return 1
    }
    const rapporto = await analizzaArchivio(staging)
    await writeFile(json, `${JSON.stringify(rapporto, null, 2)}\n`, 'utf8')
    await writeFile(md, rapportoInMarkdown(rapporto), 'utf8')
    const scartate = rapporto.confronto1.perTabella.reduce((s, t) => s + t.scartate, 0)
    uscita.scrivi(`archivio ${rapporto.archivio}: rapporto scritto in ${staging.cartella}`)
    uscita.scrivi(
      `righe scartate: ${scartate}; avvisi dello staging: ${rapporto.avvisiStaging.length}`
    )
    return 0
  } catch (e) {
    if (e instanceof StagingError) {
      uscita.errore(`staging rifiutato: ${e.message}`)
      return 2
    }
    throw e
  }
}

if (require.main === module) {
  eseguiCli(process.argv.slice(2), {
    scrivi: m => process.stdout.write(`${m}\n`),
    errore: m => process.stderr.write(`${m}\n`),
  }).then(
    codice => process.exit(codice),
    e => {
      process.stderr.write(`errore inatteso: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  )
}
