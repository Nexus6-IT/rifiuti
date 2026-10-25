import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..', '..')

/**
 * Test statico: nessuna lettura di `tenants` senza filtro.
 * `tenants` non ha RLS, quindi un `tenant.findMany()` senza `where` restituisce TUTTE le aziende
 * a chiunque lo chiami (anche col client applicativo). Ogni `tenant.findMany(` / `tenant.findFirst(`
 * del codice applicativo deve avere un `where` letterale non vuoto; un `where` che e' una variabile
 * (potrebbe valere `{}`) e' ammesso solo se il file e' nell'elenco motivato qui sotto.
 */
// Nessuna eccezione oggi (tenant.service ora filtra con escludiPiattaforma). Aggiungere qui solo con motivo.
const ECCEZIONI: Record<string, string> = {}

type Esito = 'ok' | 'senza-where' | 'where-vuoto' | 'where-variabile'

const CHIAMATA = /\.tenant\.(findMany|findFirst)\(/g

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

/** Testo tra la parentesi gia' aperta (posizione `da`) e la sua chiusura. */
function argomenti(testo: string, da: number): string {
  let livello = 1
  let i = da
  while (i < testo.length && livello > 0) {
    const c = testo[i]
    if (c === '(' || c === '{' || c === '[') livello++
    else if (c === ')' || c === '}' || c === ']') livello--
    i++
  }
  return testo.slice(da, i - 1)
}

/** Valore della chiave `where` al primo livello dell'oggetto argomento. */
function valoreWhere(arg: string): string | null {
  const t = arg.trim()
  if (!t.startsWith('{')) return null
  let livello = 0
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '{' || c === '(' || c === '[') livello++
    else if (c === '}' || c === ')' || c === ']') livello--
    else if (
      livello === 1 &&
      /\bwhere\b/.test(t.slice(i, i + 5)) &&
      /[\s{,]/.test(t[i - 1] ?? '')
    ) {
      const resto = t.slice(i + 5).trimStart()
      if (!resto.startsWith(':')) return '' // shorthand `where,` = variabile
      return resto.slice(1).trimStart()
    }
  }
  return null
}

export function valuta(arg: string): Esito {
  const v = valoreWhere(arg)
  if (v === null) return 'senza-where'
  // escludiPiattaforma(...) aggiunge sempre un filtro (esclude l'azienda tecnica): conta come where non vuoto
  if (v.startsWith('escludiPiattaforma(')) return 'ok'
  if (!v.startsWith('{')) return 'where-variabile'
  const interno = argomenti(v, 1).replace(/\s+/g, '')
  return interno === '' ? 'where-vuoto' : 'ok'
}

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return sorgenti(percorso)
    return nome.endsWith('.ts') && !nome.endsWith('.spec.ts') ? [percorso] : []
  })
}

function violazioni(): { file: string; esito: Esito }[] {
  const out: { file: string; esito: Esito }[] = []
  for (const f of sorgenti(SRC)) {
    const rel = relative(SRC, f).split(sep).join('/')
    if (rel.includes('/seed') || rel.startsWith('seed')) continue
    const testo = senzaCommenti(readFileSync(f, 'utf8'))
    for (const m of testo.matchAll(CHIAMATA)) {
      const esito = valuta(argomenti(testo, (m.index ?? 0) + m[0].length))
      if (esito !== 'ok') out.push({ file: rel, esito })
    }
  }
  return out
}

describe('letture di tenants', () => {
  it('ogni tenant.findMany/findFirst ha un where letterale non vuoto (salvo eccezioni motivate)', () => {
    const fuori = violazioni().filter(v => !(v.file in ECCEZIONI && v.esito === 'where-variabile'))
    expect(fuori).toEqual([])
  })

  it('le eccezioni sono ancora necessarie e hanno un motivo', () => {
    const presenti = new Set(violazioni().map(v => v.file))
    for (const [file, motivo] of Object.entries(ECCEZIONI)) {
      expect({ file, ancoraServe: presenti.has(file) }).toEqual({ file, ancoraServe: true })
      expect(motivo.trim().length).toBeGreaterThan(10)
    }
  })

  it("l'analizzatore riconosce i casi sbagliati", () => {
    expect(valuta('')).toBe('senza-where')
    expect(valuta('{ select: { id: true } }')).toBe('senza-where')
    expect(valuta('{ where: {}, select: { id: true } }')).toBe('where-vuoto')
    expect(valuta('{ where: { },\n orderBy: {} }')).toBe('where-vuoto')
    expect(valuta('{ where, orderBy: {} }')).toBe('where-variabile')
    expect(valuta('{ where: filtro }')).toBe('where-variabile')
    expect(valuta('{ select: { x: { where: { a: 1 } } } }')).toBe('senza-where')
    expect(valuta('{ where: { id: { in: ids } } }')).toBe('ok')
    expect(valuta('{ where: escludiPiattaforma({ a: 1 }), select: {} }')).toBe('ok')
  })
})
