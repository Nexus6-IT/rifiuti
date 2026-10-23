import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'

/**
 * Raccolta delle rotte registrate dalla fake, senza toccare `creaApp()`:
 * `fastify` e' sostituito da un wrapper che, subito dopo la creazione
 * dell'istanza radice, aggancia l'hook `onRoute`. L'hook radice vale per tutti
 * i plugin registrati dopo, quindi vede ogni rotta (HEAD automatici inclusi,
 * che scartiamo piu' sotto).
 */
const ROTTE_REGISTRATE: Array<{ metodo: string; url: string }> = []

jest.mock('fastify', () => {
  const originale = jest.requireActual('fastify')
  const fabbrica = (...argomenti: unknown[]) => {
    const istanza = originale.fastify(...argomenti)
    istanza.addHook('onRoute', (rotta: { method: string | string[]; url: string }) => {
      for (const metodo of ([] as string[]).concat(rotta.method)) {
        ROTTE_REGISTRATE.push({ metodo: metodo.toUpperCase(), url: rotta.url })
      }
    })
    return istanza
  }
  return Object.assign(fabbrica, originale, { default: fabbrica, fastify: fabbrica })
})

// Import dopo il mock (jest lo solleva comunque in cima, l'ordine qui e' solo
// per leggibilita').
import { creaApp } from '../src/app'

/**
 * Guardia contro rotte inventate: il finto ha riprodotto per mesi un percorso
 * (`/ca-rentri/v1.0/credentials/sign-hash`) assente dal contratto ufficiale, e
 * il backend lo ha imitato, cosi' i test dell'oracolo passavano contro una
 * rotta che il vero RENTRI non espone. Qui ogni rotta della fake deve esistere,
 * con lo stesso metodo, nel contratto OpenAPI del suo servizio.
 */

const DIRECTORY_CONTRATTI = join(__dirname, '..', '..', '..', 'docs', 'contracts', 'rentri')

/** Prefisso della fake -> file del contratto ufficiale. */
const CONTRATTO_PER_PREFISSO: Record<string, string> = {
  '/anagrafiche/v1.0': 'anagrafiche.yaml',
  '/ca-rentri/v1.0': 'ca-rentri.yaml',
  '/codifiche/v1.0': 'codifiche.yaml',
  '/dati-registri/v1.0': 'dati-registri.yaml',
  '/formulari/v1.0': 'formulari.yaml',
  '/vidimazione-formulari/v1.0': 'vidimazione-formulari.yaml',
}

/** Canale di controllo, token e salute: non fanno parte dei contratti. */
const PREFISSI_TECNICI_ESCLUSI = ['/__controllo', '/__salute', '/token']

/**
 * Scostamenti gia' presenti in servizi diversi da ca-rentri: non si correggono
 * in questo piano. Ogni voce e' `METODO /path-con-{param}` e dice perche' resta.
 * Il test fallisce se una voce non e' piu' uno scostamento, cosi' l'elenco non
 * invecchia.
 */
const SCOSTAMENTI_NOTI: Record<string, string> = {}

const METODI = ['get', 'post', 'put', 'patch', 'delete']

/** `{nome}` e `:nome` valgono lo stesso: si confronta la forma, non il nome. */
function normalizza(url: string): string {
  return url.replace(/\{[^}]+\}/g, '{}').replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}').replace(/\/+$/, '')
}

function chiaviContratto(prefisso: string): Set<string> {
  const contratto = load(readFileSync(join(DIRECTORY_CONTRATTI, CONTRATTO_PER_PREFISSO[prefisso]), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>
  }
  const chiavi = new Set<string>()
  for (const [percorso, operazioni] of Object.entries(contratto.paths)) {
    for (const metodo of METODI) {
      if (operazioni[metodo]) chiavi.add(`${metodo.toUpperCase()} ${prefisso}${normalizza(percorso)}`)
    }
  }
  return chiavi
}

/** Scostamenti correnti, come `METODO path` con i parametri scritti `{nome}`. */
function calcolaScostamenti(): string[] {
  creaApp()

  const contratti = new Map<string, Set<string>>()
  const scostamenti = new Set<string>()

  for (const { metodo, url } of ROTTE_REGISTRATE) {
    if (metodo === 'HEAD') continue // aggiunti da Fastify per ogni GET
    if (PREFISSI_TECNICI_ESCLUSI.some(p => url === p || url.startsWith(`${p}/`))) continue

    const prefisso = Object.keys(CONTRATTO_PER_PREFISSO).find(p => url.startsWith(`${p}/`) || url === p)
    // Ne' nella mappa ne' fra gli esclusi: va classificata esplicitamente.
    const etichetta = `${metodo} ${url.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')}`
    if (!prefisso) {
      scostamenti.add(`${etichetta} (servizio non mappato)`)
      continue
    }
    if (!contratti.has(prefisso)) contratti.set(prefisso, chiaviContratto(prefisso))
    if (!contratti.get(prefisso)!.has(`${metodo} ${prefisso}${normalizza(url.slice(prefisso.length))}`)) {
      scostamenti.add(etichetta)
    }
  }
  return [...scostamenti].sort()
}

describe('rotte della fake allineate ai contratti RENTRI', () => {
  it('ogni rotta della fake esiste nel contratto del suo servizio', () => {
    const inattesi = calcolaScostamenti().filter(voce => !(voce in SCOSTAMENTI_NOTI))
    expect(inattesi).toEqual([])
  })

  it('nessuna voce di SCOSTAMENTI_NOTI è superata', () => {
    const correnti = new Set(calcolaScostamenti())
    const superate = Object.keys(SCOSTAMENTI_NOTI).filter(voce => !correnti.has(voce))
    expect(superate).toEqual([])
  })
})
