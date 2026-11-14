import { resolve } from 'path'
import {
  estraiStaging,
  EstrazioneError,
} from '../../../apps/backend/src/application/migrazione/estrazione/estrai-staging'
import { apriSorgente } from './adattatore-mssql'
import { destinazioneAmmessa } from './destinazione'

/**
 * Estrattore WinWaste: legge da SQL Server (SOLA LETTURA) e scrive lo staging
 * `winwaste-staging/1` in `<out>/WW<ditta><anno>/`.
 *
 *   WASTEFLOW_MSSQL_PASSWORD=... npm run estrai -- \
 *     --server 127.0.0.1 --porta 14339 --database WW00012026 --utente lettore \
 *     --out ~/staging-winwaste [--fidati-del-certificato]
 *
 * La password si passa SOLO dall'ambiente (mai da riga di comando). Il login
 * deve essere di sola lettura: con permessi di scrittura l'estrazione non parte.
 * La destinazione non puo' stare dentro un repository git, salvo in una
 * cartella `staging-winwaste` (coperta da `.gitignore`).
 */
function opzioni(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`argomento inatteso: ${a}`)
    const nome = a.slice(2)
    if (nome === 'fidati-del-certificato') m.set(nome, '1')
    else {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`manca il valore di --${nome}`)
      m.set(nome, v)
    }
  }
  return m
}

async function main(): Promise<number> {
  let o: Map<string, string>
  try {
    o = opzioni(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`)
    return 64
  }
  const richiesti = ['server', 'database', 'utente', 'out']
  const mancanti = richiesti.filter((k) => !o.has(k))
  const password = process.env.WASTEFLOW_MSSQL_PASSWORD
  if (mancanti.length > 0 || !password) {
    process.stderr.write(
      `uso: WASTEFLOW_MSSQL_PASSWORD=... estrai --server H [--porta 1433] --database WWddddaaaa --utente U --out DIR [--fidati-del-certificato]\nmancano: ${[...mancanti.map((k) => `--${k}`), ...(password ? [] : ['WASTEFLOW_MSSQL_PASSWORD'])].join(', ')}\n`
    )
    return 64
  }
  const out = o.get('out') as string
  if (!destinazioneAmmessa(out)) {
    process.stderr.write(
      'la destinazione sta dentro un repository git: usare una cartella fuori dal repo o chiamata staging-winwaste\n'
    )
    return 64
  }
  const sorgente = await apriSorgente({
    server: o.get('server') as string,
    porta: Number(o.get('porta') ?? 1433),
    database: o.get('database') as string,
    utente: o.get('utente') as string,
    password,
    fidatiDelCertificato: o.has('fidati-del-certificato'),
  })
  try {
    const r = await estraiStaging(sorgente, resolve(out))
    process.stdout.write(`staging scritto in ${r.cartella}\n`)
    for (const [nome, t] of Object.entries(r.manifest.tabelle)) {
      process.stdout.write(`  ${nome}: ${t.righe} righe\n`)
    }
    if (r.tabelleAssenti.length > 0) {
      process.stdout.write(`tabelle assenti dal database: ${r.tabelleAssenti.join(', ')}\n`)
    }
    return 0
  } catch (e) {
    if (e instanceof EstrazioneError) {
      process.stderr.write(`estrazione rifiutata: ${e.message}\n`)
      return 2
    }
    throw e
  } finally {
    await sorgente.chiudi()
  }
}

if (require.main === module) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      process.stderr.write(`errore: ${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    }
  )
}
