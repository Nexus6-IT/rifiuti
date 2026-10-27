import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..')

/**
 * `JwtStrategy.validate` restituisce `CurrentUserPayload`, che ha `id` e NON `userId`: ogni
 * lettura di `user.userId` e' sempre `undefined` (rate limit per IP anche da autenticati, log
 * "anonymous", assegnazioni senza utente). Questa guardia fallisce se un sorgente non di test
 * torna a leggerlo.
 *
 * LIMITE NOTO: vede solo gli accessi diretti (`user.userId`, `user?.userId`, `user!.userId`,
 * `req.user.userId`, `user['userId']`); un alias (`const u = req.user; u.userId`) non viene
 * rilevato e resta alla revisione del codice.
 */
const ACCESSI_VIETATI: RegExp[] = [
  /\buser\s*[?!]?\s*\.\s*userId\b/,
  /\buser\s*[?!]?\s*\.?\s*\[\s*['"`]userId['"`]\s*\]/,
]

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return nome === 'node_modules' ? [] : sorgenti(percorso)
    if (!nome.endsWith('.ts') || nome.endsWith('.spec.ts') || nome.endsWith('.d.ts')) return []
    return [percorso]
  })
}

/** Toglie i commenti rispettando le stringhe (un URL con `//` non e' un commento). */
function senzaCommenti(testo: string): string {
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

function violazioni(sorgente: string): string[] {
  const codice = senzaCommenti(sorgente)
  return ACCESSI_VIETATI.filter(re => re.test(codice)).map(re => re.source)
}

describe("nessun sorgente legge user.userId (il campo del token e' `id`)", () => {
  it.each([
    ['user.userId', 'const x = user.userId'],
    ['user?.userId', 'const x = user?.userId'],
    ['user!.userId', 'const x = user!.userId'],
    ['request.user?.userId', 'log(`u=${request.user?.userId}`)'],
    ["user['userId']", "const x = user['userId']"],
  ])('rileva %s in un sorgente finto', (_nome, codice) => {
    expect(violazioni(codice).length).toBeGreaterThan(0)
  })

  it("non segnala commenti ne' altri campi", () => {
    expect(violazioni('// user.userId\nconst x = user.id\nconst y = grant.userId')).toEqual([])
  })

  it("nessun .ts non di test sotto src contiene l'accesso", () => {
    const colpevoli = sorgenti(SRC)
      .filter(f => violazioni(readFileSync(f, 'utf8')).length > 0)
      .map(f => relative(SRC, f).split(sep).join('/'))
    expect(colpevoli).toEqual([])
  })
})
