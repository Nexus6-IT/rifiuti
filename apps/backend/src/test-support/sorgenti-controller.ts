import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * Helper condivisi dalle guardie statiche sui controller (`api/controller-*.spec.ts`):
 * leggono i sorgenti su disco, senza avviare l'applicazione.
 */

/** Radice dei sorgenti del backend (`apps/backend/src`). */
export const SRC = join(__dirname, '..')

// Costruita con `RegExp` perche' un letterale con il nome del decoratore farebbe riconoscere
// questo stesso file come un controller.
const DICHIARA_CONTROLLER = new RegExp('@Controller' + String.raw`\(`)

/** Ogni file .ts non di test sotto `dir` che dichiara un controller (non solo `*.controller.ts`). */
export function controller(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return nome === 'node_modules' ? [] : controller(percorso)
    if (!nome.endsWith('.ts') || nome.endsWith('.spec.ts') || nome.endsWith('.d.ts')) return []
    return DICHIARA_CONTROLLER.test(readFileSync(percorso, 'utf8')) ? [percorso] : []
  })
}

/** Toglie i commenti rispettando le stringhe (un URL con `//` non e' un commento). */
export function senzaCommenti(testo: string): string {
  let fuori = ''
  let i = 0
  while (i < testo.length) {
    const c = testo[i]
    const n = testo[i + 1]
    if (c === '/' && n === '/') {
      while (i < testo.length && testo[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      const fine = testo.indexOf('*/', i + 2)
      i = fine === -1 ? testo.length : fine + 2
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < testo.length && testo[j] !== c) j += testo[j] === '\\' ? 2 : 1
      fuori += testo.slice(i, j + 1)
      i = j + 1
    } else {
      fuori += c
      i++
    }
  }
  return fuori
}

/**
 * Come `senzaCommenti`, ma svuota anche il contenuto delle stringhe: una stringa che parla di
 * `user.tenantId` (messaggio, log) non e' un accesso. Restano visibili le chiavi esatte
 * `'user'` e `'tenantId'` (servono a riconoscere `req['user']['tenantId']`) e i template
 * literal con interpolazione `${...}`, che contengono codice vero.
 */
export function soloCodice(testo: string): string {
  const senza = senzaCommenti(testo)
  let out = ''
  let i = 0
  while (i < senza.length) {
    const c = senza[i]
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < senza.length && senza[j] !== c) j += senza[j] === '\\' ? 2 : 1
      const contenuto = senza.slice(i + 1, j)
      const tieni =
        contenuto === 'user' || contenuto === 'tenantId' || (c === '`' && contenuto.includes('${'))
      out += tieni ? senza.slice(i, j + 1) : c + c
      i = j + 1
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Sorgenti dei controller reali, per percorso relativo a `src/` (separatore `/`). */
export function leggiControllerReali(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of controller(SRC)) {
    out[relative(SRC, f).split(sep).join('/')] = readFileSync(f, 'utf8')
  }
  return out
}
