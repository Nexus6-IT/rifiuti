import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..', '..')
const BACKEND = join(SRC, '..')
// Radici scansionate: il codice applicativo, i seed e gli script (anche questi leggono `tenants`).
const RADICI = [
  { dir: SRC, prefisso: '' },
  { dir: join(BACKEND, 'prisma', 'seeds'), prefisso: 'prisma/seeds/' },
  { dir: join(BACKEND, 'scripts'), prefisso: 'scripts/' },
]

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
// Eccezioni PER SINGOLA CHIAMATA: file + testo della chiamata (prefisso incluso, spazi normalizzati;
// `contiene` deve comparire nella chiamata). Ogni eccezione deve combaciare con UNA sola chiamata
// non conforme: una nuova lettura senza filtro nello stesso file, anche identica, fa fallire il test.
interface Eccezione {
  file: string
  contiene: string
  motivo: string
}
const ECCEZIONI: Eccezione[] = [
  {
    file: 'application/admin/tenant.service.ts',
    contiene: 'this.sistema.tenant.findMany({ where: escludiPiattaforma(where)',
    motivo:
      "list() del super admin: il `where` e' una variabile ({} per elencare di proposito tutte le aziende) ma passa da escludiPiattaforma()",
  },
  {
    file: 'application/admin/tenant.service.ts',
    contiene: 'this.prisma.tenant.findMany({ where: escludiPiattaforma(where)',
    motivo:
      "list() dell'ADMIN: il `where` e' una variabile (filtro sulle aziende possedute) ma passa da escludiPiattaforma()",
  },
  {
    file: 'application/notifications/deadline-checker.service.ts',
    contiene: 'this.sistema.tenant.findMany({ where: escludiPiattaforma({ subscriptionStatus',
    motivo:
      'il `where` contiene lo spread di FILTRO_AZIENDE_TENUTE_AL_MUD (costante di filtro, mai vuota) dentro escludiPiattaforma() e subscriptionStatus letterale',
  },
  {
    file: 'infrastructure/jobs/rentri-trasmissioni-sospese.job.ts',
    contiene: 'this.sistema.tenant.findMany({ where: escludiPiattaforma(), select: { id: true }',
    motivo:
      "il job riprende i FIR SYNCING di tutte le aziende clienti, qualunque abbonamento (una trasmissione gia' partita va portata a termine): escludiPiattaforma() senza argomento = tutte tranne la piattaforma; il filtro per modulo rentri viene dopo, con tenantConModulo",
  },
  {
    file: 'prisma/seeds/roles.seed.ts',
    contiene: 'prisma.tenant.findMany({ where: escludiPiattaforma() })',
    motivo:
      'il seed dei ruoli scorre tutte le aziende clienti: escludiPiattaforma() senza argomento = tutte tranne la piattaforma',
  },
]

type Esito = 'ok' | 'senza-where' | 'where-vuoto' | 'where-variabile' | 'raw-tenants'

const CHIAMATA =
  /(?<![\w$])((?:[\w$]+\s*\.\s*)*)tenant\s*\.\s*(findMany|findFirst|findFirstOrThrow|count|aggregate|groupBy)\s*\(/g
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

interface Violazione {
  file: string
  esito: Esito
  chiamata: string
}

const normalizza = (t: string) => t.replace(/\s+/g, ' ').trim()

function dettagliDi(testo: string, file = ''): Violazione[] {
  const out: Violazione[] = []
  for (const m of testo.matchAll(CHIAMATA)) {
    const args = argomenti(testo, (m.index ?? 0) + m[0].length)
    const esito = valuta(args)
    if (esito !== 'ok') out.push({ file, esito, chiamata: normalizza(m[0] + args + ')') })
  }
  for (const raw of testo.matchAll(RAW_TENANTS))
    out.push({ file, esito: 'raw-tenants', chiamata: normalizza(raw[0]) })
  return out
}

function violazioniDi(testo: string): Esito[] {
  return dettagliDi(testo).map(v => v.esito)
}

function violazioni(): Violazione[] {
  const out: Violazione[] = []
  for (const { dir, prefisso } of RADICI) {
    if (!existsSync(dir)) continue
    for (const f of sorgenti(dir)) {
      const rel = relative(dir, f).split(sep).join('/')
      if (!prefisso && (rel.includes('/seed') || rel.startsWith('seed'))) continue
      out.push(...dettagliDi(senzaCommenti(readFileSync(f, 'utf8')), prefisso + rel))
    }
  }
  return out
}

const copre = (e: Eccezione, v: Violazione) => v.file === e.file && v.chiamata.includes(e.contiene)

/** Violazioni non coperte da un'eccezione + eccezioni che non combaciano con esattamente una chiamata. */
function esamina(viol: Violazione[], eccezioni: Eccezione[]) {
  return {
    fuori: viol.filter(v => !eccezioni.some(e => copre(e, v))),
    eccezioniNonUniche: eccezioni
      .filter(e => viol.filter(v => copre(e, v)).length !== 1)
      .map(e => e.contiene),
  }
}

describe('letture di tenants', () => {
  it('ogni lettura di tenants ha un where letterale non vuoto (salvo eccezioni motivate)', () => {
    expect(esamina(violazioni(), ECCEZIONI).fuori).toEqual([])
  })

  it('ogni eccezione copre una sola chiamata, ancora presente, ed ha un motivo', () => {
    expect(esamina(violazioni(), ECCEZIONI).eccezioniNonUniche).toEqual([])
    for (const e of ECCEZIONI) expect(e.motivo.trim().length).toBeGreaterThan(10)
  })

  it('test del test: una nuova lettura senza filtro in un file con eccezione fa fallire', () => {
    const ecc = ECCEZIONI[0]
    const base = violazioni()
    // altra chiamata non conforme nello stesso file, di forma diversa
    const nuova: Violazione = {
      file: ecc.file,
      esito: 'senza-where',
      chiamata: 'this.prisma.tenant.findMany({ select: {} })',
    }
    expect(esamina([...base, nuova], ECCEZIONI).fuori).toEqual([nuova])
    // altra chiamata IDENTICA a quella eccepita: l'eccezione non e' piu' univoca
    const clone = { ...base.find(v => copre(ecc, v))! }
    expect(esamina([...base, clone], ECCEZIONI).eccezioniNonUniche).toEqual([ecc.contiene])
    // chiamata eccepita sparita: l'eccezione e' da togliere
    expect(esamina([], ECCEZIONI).eccezioniNonUniche).toHaveLength(ECCEZIONI.length)
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
    expect(violazioniDi('mytenant.findMany()')).toEqual([])
    expect(dettagliDi('this.sistema.tenant\n .findMany({ select: {} })')[0].chiamata).toBe(
      'this.sistema.tenant .findMany({ select: {} })'
    )
  })
})
