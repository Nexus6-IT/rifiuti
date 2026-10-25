import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..', '..')

/**
 * Test statico: nessuna lettura di `tenants` senza filtro.
 * `tenants` non ha RLS, quindi un `tenant.findMany()` senza `where` restituisce TUTTE le aziende
 * a chiunque lo chiami (anche col client applicativo). Ogni lettura `tenant.<metodo>(` del codice
 * applicativo (findMany, findFirst, findFirstOrThrow, count, aggregate, groupBy, anche con la
 * chiamata spezzata su piu' righe) deve avere un `where` letterale non vuoto, oppure
 * `escludiPiattaforma({ ...letterale non vuoto... })`. Un `where` che e' una variabile (potrebbe
 * valere `{}`), uno spread nell'oggetto argomento, o `escludiPiattaforma` con argomento vuoto o
 * variabile, e' una violazione, salvo file nell'elenco ECCEZIONI con un motivo. Anche un
 * `$queryRaw`/`$executeRaw` che legge `FROM tenants` e' una violazione.
 *
 * ATTENZIONE: e' un tripwire sulla FORMA del filtro, non una garanzia sul client usato (app o
 * sistema) ne' sul contenuto semantico del filtro: serve a far notare a chi scrive e a chi
 * rivede una lettura di `tenants` aperta a tutte le aziende.
 */
// Eccezioni: un file solo con un motivo scritto. Task 4 ha messo escludiPiattaforma() sulle liste.
const ECCEZIONI: Record<string, string> = {
  'application/admin/tenant.service.ts':
    "list(): il `where` e' una variabile ({} per il super admin, che elenca di proposito tutte le aziende) ma passa da escludiPiattaforma(); count() della quota con where letterale",
  'application/notifications/deadline-checker.service.ts':
    'il `where` contiene lo spread di FILTRO_AZIENDE_TENUTE_AL_MUD (costante di filtro, mai vuota) dentro escludiPiattaforma() e subscriptionStatus letterale',
}

type Esito = 'ok' | 'senza-where' | 'where-vuoto' | 'where-variabile' | 'raw-tenants'

const CHIAMATA =
  /\btenant\s*\.\s*(findMany|findFirst|findFirstOrThrow|count|aggregate|groupBy)\s*\(/g
const RAW_TENANTS = /\$(queryRaw|executeRaw)(Unsafe)?[\s\S]{0,400}?\bfrom\s+"?tenants"?\b/gi

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

/** Indice del delimitatore che chiude la stringa aperta in `i`. */
function fineStringa(t: string, i: number): number {
  const c = t[i]
  let j = i + 1
  while (j < t.length && t[j] !== c) j += t[j] === '\\' ? 2 : 1
  return j
}

/** Testo tra la parentesi gia' aperta (posizione `da`) e la sua chiusura; parentesi nelle stringhe ignorate. */
function argomenti(testo: string, da: number): string {
  let livello = 1
  let i = da
  while (i < testo.length && livello > 0) {
    const c = testo[i]
    if (c === "'" || c === '"' || c === '`') i = fineStringa(testo, i)
    else if (c === '(' || c === '{' || c === '[') livello++
    else if (c === ')' || c === '}' || c === ']') livello--
    i++
  }
  return testo.slice(da, i - 1)
}

/**
 * Esamina l'oggetto argomento `{ ... }` al primo livello: ritorna il valore di `where`
 * (stringa, `''` per lo shorthand), `null` se manca, `'...spread'` se c'e' uno spread.
 */
function valoreWhere(arg: string): string | null {
  const t = arg.trim()
  if (!t.startsWith('{')) return null
  let livello = 0
  let trovato: string | null = null
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === "'" || c === '"' || c === '`') {
      i = fineStringa(t, i)
    } else if (c === '{' || c === '(' || c === '[') {
      livello++
    } else if (c === '}' || c === ')' || c === ']') {
      livello--
    } else if (livello === 1) {
      if (t.startsWith('...', i)) return '...spread'
      if (trovato === null && /[\s{,]/.test(t[i - 1] ?? '')) {
        const m = /^where(?![\w$])\s*(:?)/.exec(t.slice(i))
        if (m) {
          trovato = m[1] === ':' ? t.slice(i + m[0].length).trimStart() : ''
          i += 4
        }
      }
    }
  }
  return trovato
}

/** Un oggetto letterale `{ ... }` non vuoto e senza spread al primo livello. */
function oggettoNonVuoto(v: string): Esito {
  if (!v.startsWith('{')) return 'where-variabile'
  const interno = argomenti(v, 1)
  if (interno.replace(/\s+/g, '') === '') return 'where-vuoto'
  if (valoreWhere(`{${interno}}`) === '...spread') return 'where-variabile'
  return 'ok'
}

export function valuta(arg: string): Esito {
  const v = valoreWhere(arg)
  if (v === null) return 'senza-where'
  if (v === '...spread') return 'where-variabile'
  const helper = /^escludiPiattaforma\s*\(/.exec(v)
  if (helper) return oggettoNonVuoto(argomenti(v, helper[0].length).trim())
  return oggettoNonVuoto(v)
}

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return sorgenti(percorso)
    return nome.endsWith('.ts') && !nome.endsWith('.spec.ts') ? [percorso] : []
  })
}

function violazioniDi(testo: string): Esito[] {
  const out: Esito[] = []
  for (const m of testo.matchAll(CHIAMATA)) {
    const esito = valuta(argomenti(testo, (m.index ?? 0) + m[0].length))
    if (esito !== 'ok') out.push(esito)
  }
  for (const _raw of testo.matchAll(RAW_TENANTS)) out.push('raw-tenants')
  return out
}

function violazioni(): { file: string; esito: Esito }[] {
  const out: { file: string; esito: Esito }[] = []
  for (const f of sorgenti(SRC)) {
    const rel = relative(SRC, f).split(sep).join('/')
    if (rel.includes('/seed') || rel.startsWith('seed')) continue
    const testo = senzaCommenti(readFileSync(f, 'utf8'))
    for (const esito of violazioniDi(testo)) out.push({ file: rel, esito })
  }
  return out
}

describe('letture di tenants', () => {
  it('ogni lettura di tenants ha un where letterale non vuoto (salvo eccezioni motivate)', () => {
    const fuori = violazioni().filter(v => !(v.file in ECCEZIONI))
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
    expect(valuta('{ whereX: { a: 1 } }')).toBe('senza-where')
    expect(valuta('{ select: { x: { where: { a: 1 } } } }')).toBe('senza-where')
    expect(valuta("{ select: { 'a}': true } }")).toBe('senza-where')
    expect(valuta("{ where: { nome: 'x)' } }")).toBe('ok')
    expect(valuta('{ ...base, where: { a: 1 } }')).toBe('where-variabile')
    expect(valuta('{ where: escludiPiattaforma() }')).toBe('where-variabile')
    expect(valuta('{ where: escludiPiattaforma({}) }')).toBe('where-vuoto')
    expect(valuta('{ where: escludiPiattaforma(w) }')).toBe('where-variabile')
    expect(valuta('{ where: { ...w } }')).toBe('where-variabile')
  })

  it("l'analizzatore accetta i casi corretti e vede le forme alternative", () => {
    expect(valuta('{ where: { id: { in: ids } } }')).toBe('ok')
    expect(valuta('{ where: escludiPiattaforma({ a: 1 }), select: {} }')).toBe('ok')
    expect(violazioniDi('prisma.tenant\n  .findMany({ select: {} })')).toEqual(['senza-where'])
    expect(violazioniDi('x.tenant.count()')).toEqual(['senza-where'])
    expect(violazioniDi('x.tenant.groupBy({ by: ["a"] })')).toEqual(['senza-where'])
    expect(violazioniDi('x.tenant.findFirstOrThrow({ where: {} })')).toEqual(['where-vuoto'])
    expect(violazioniDi('x.$queryRaw`SELECT * FROM tenants`')).toEqual(['raw-tenants'])
    expect(violazioniDi('x.tenant.count({ where: { a: 1 } })')).toEqual([])
  })
})
