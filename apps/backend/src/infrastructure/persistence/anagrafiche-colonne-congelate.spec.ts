/**
 * Guardia D6/I7 (F2-10): le colonne vecchie di `produttori`, `trasportatori` e `destinatari`
 * (ragione sociale, partita IVA, indirizzo, contatti) sono una copia congelata: nessuno le scrive e
 * nessuno le legge, salvo l'elenco di eccezioni qui sotto.
 *
 * `@ignore` nello schema le toglie dal client Prisma, quindi tsc blocca gli accessi tipizzati; ma
 * non vede gli accessi dinamici (`db[nomeParte]`, `client[this.modello]`, `as any`) ne' lo SQL
 * grezzo. Questa guardia scorre i file non di test sotto `src/` e li cerca.
 */
import * as fs from 'fs'
import * as path from 'path'

const SRC = path.resolve(__dirname, '..', '..')

/** Nomi (client Prisma e SQL) delle colonne congelate. */
const NOMI_CLIENT = [
  'ragioneSociale',
  'partitaIVA',
  'via',
  'civico',
  'cap',
  'comune',
  'provincia',
  'email',
  'telefono',
  'pec',
]
const NOMI_SQL = [
  'ragione_sociale',
  'partita_iva',
  'via',
  'civico',
  'cap',
  'comune',
  'provincia',
  'email',
  'telefono',
  'pec',
]

/**
 * Eccezioni esplicite, per file (percorso relativo a `src/`) e nome. Chi ne aggiunge una deve
 * motivarla qui. Oggi: nessuna per i nomi sopra. `ragioneSocialeStorica` (la ragione sociale
 * congelata rinominata nel client) puo' comparire solo nel MUD (D10/I2: le integrazioni salvate
 * sono agganciate a quel nome).
 */
const ECCEZIONI_NOMI: Record<string, string[]> = {}
const ECCEZIONI_STORICA = ['application/mud/aggregazione/mud-aggregazione.service.ts']

const OPERAZIONI =
  'create|createMany|update|updateMany|upsert|findFirst|findFirstOrThrow|findMany|findUnique|findUniqueOrThrow|count|aggregate|groupBy|delete|deleteMany'

function senzaCommenti(testo: string): string {
  return testo
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** Testo fra la parentesi aperta in `da` e la sua chiusura (esclusa). */
function argomento(testo: string, da: number): string {
  let profondita = 0
  for (let i = da; i < testo.length; i++) {
    if (testo[i] === '(') profondita++
    else if (testo[i] === ')' && --profondita === 0) return testo.slice(da + 1, i)
  }
  return testo.slice(da + 1)
}

/** Toglie i blocchi `ditta: {...}` / `sede: {...}` (relazioni: i loro campi sono legittimi). */
function senzaRelazioni(testo: string): string {
  let out = testo
  const rx = /\b(ditta|sede)\s*:\s*(\{|true)/
  for (let m = rx.exec(out); m; m = rx.exec(out)) {
    let fine = m.index + m[0].length
    if (m[2] === '{') {
      let p = 1
      while (fine < out.length && p > 0) {
        if (out[fine] === '{') p++
        else if (out[fine] === '}') p--
        fine++
      }
    }
    out = out.slice(0, m.index) + ' ' + out.slice(fine)
  }
  return out
}

/** Letterali `const x = { ... }` delle variabili usate come valore di select/data/include/where. */
function letteraliDelleVariabili(testo: string, arg: string): string {
  const nomi = new Set<string>()
  const rx =
    /\b(?:select|data|include|where|orderBy)\s*:\s*([A-Za-z_]\w*)\s*(?=[,}])|[{,]\s*(select|data|include|where|orderBy)\s*(?=[,}])/g
  for (let m = rx.exec(arg); m; m = rx.exec(arg)) nomi.add(m[1] ?? m[2])
  let out = ''
  for (const nome of nomi) {
    const dichiarazione = new RegExp(`(?:const|let)\\s+${nome}\\b[^=\\n]*=\\s*\\{`).exec(testo)
    if (!dichiarazione) continue
    let fine = dichiarazione.index + dichiarazione[0].length
    let p = 1
    while (fine < testo.length && p > 0) {
      if (testo[fine] === '{') p++
      else if (testo[fine] === '}') p--
      fine++
    }
    out += ' ' + testo.slice(dichiarazione.index + dichiarazione[0].length - 1, fine)
  }
  return out
}

/** Violazioni in un file: nomi congelati usati in una chiamata Prisma su un ruolo (anche dinamica). */
export function trovaViolazioni(testoGrezzo: string): string[] {
  const testo = senzaCommenti(testoGrezzo)
  const trovate = new Set<string>()
  const chiamate = [
    // db.produttore.create(...), tx.destinatario.findMany(...)
    new RegExp(`\\.(?:produttore|trasportatore|destinatario)\\.(?:${OPERAZIONI})\\(`, 'g'),
    // client[this.modello].create(...), db[nomeParte].findFirst(...), (x as any)[nome].update(...)
    new RegExp(`\\)?\\[[^\\]\\n]+\\]\\.(?:${OPERAZIONI})\\(`, 'g'),
  ]
  for (const rx of chiamate) {
    for (let m = rx.exec(testo); m; m = rx.exec(testo)) {
      const arg0 = argomento(testo, m.index + m[0].length - 1)
      // `select`/`data`/`include` passati come variabile (`select,` o `select: x`): si guarda il
      // letterale della variabile, che tsc non controlla (non e' un oggetto letterale in linea)
      const arg = senzaRelazioni(arg0 + ' ' + letteraliDelleVariabili(testo, arg0))
      for (const nome of NOMI_CLIENT) {
        if (new RegExp(`\\b${nome}\\s*:|[{,]\\s*${nome}\\s*(?=[,}])`).test(arg)) trovate.add(nome)
      }
    }
  }
  // SQL grezzo che nomina una tabella di ruolo insieme a una colonna congelata
  if (
    /\$(?:queryRaw|executeRaw)/.test(testo) &&
    /\b(produttori|trasportatori|destinatari)\b/.test(testo)
  ) {
    for (const nome of NOMI_SQL) {
      if (
        new RegExp(`\\b(?:p|t|d|produttori|trasportatori|destinatari)\\.${nome}\\b`).test(testo)
      ) {
        trovate.add(`sql:${nome}`)
      }
    }
  }
  return [...trovate]
}

function fileNonDiTest(cartella: string): string[] {
  const out: string[] = []
  for (const voce of fs.readdirSync(cartella, { withFileTypes: true })) {
    const p = path.join(cartella, voce.name)
    if (voce.isDirectory()) {
      if (voce.name === 'test-support') continue
      out.push(...fileNonDiTest(p))
    } else if (
      /\.ts$/.test(voce.name) &&
      !/\.(spec|e2e-spec)\.ts$/.test(voce.name) &&
      !/\.d\.ts$/.test(voce.name)
    ) {
      out.push(p)
    }
  }
  return out
}

describe('Colonne congelate delle righe di ruolo (D6, I7)', () => {
  const file = fileNonDiTest(SRC)

  it('la guardia vede gli accessi tipizzati, dinamici e in SQL (autoverifica)', () => {
    expect(trovaViolazioni('db.produttore.create({ data: { partitaIVA: x, dittaId } })')).toEqual([
      'partitaIVA',
    ])
    expect(trovaViolazioni('(client as any)[this.modello].update({ data: { via: v } })')).toEqual([
      'via',
    ])
    expect(
      trovaViolazioni('await db[nomeParte].findMany({ select: { email, id: true } })')
    ).toEqual(['email'])
    expect(trovaViolazioni('tx.$queryRaw`SELECT p.partita_iva FROM produttori p`')).toEqual([
      'sql:partita_iva',
    ])
    // select passato come variabile: si controlla il letterale della variabile
    expect(
      trovaViolazioni(
        'const select = { id: true, ragioneSociale: true }\nawait this.prisma.produttore.findMany({ where: { tenantId }, select })'
      )
    ).toEqual(['ragioneSociale'])
    // le relazioni sono legittime, i commenti non contano
    expect(
      trovaViolazioni(
        'db.destinatario.findMany({ include: { ditta: { select: { ragioneSociale: true } }, sede: true } }) // via: 1'
      )
    ).toEqual([])
  })

  it('nessun file non di test usa le colonne congelate (salvo eccezioni esplicite)', () => {
    const violazioni: string[] = []
    for (const f of file) {
      const rel = path.relative(SRC, f).split(path.sep).join('/')
      const ammessi = ECCEZIONI_NOMI[rel] ?? []
      for (const v of trovaViolazioni(fs.readFileSync(f, 'utf8'))) {
        if (!ammessi.includes(v)) violazioni.push(`${rel}: ${v}`)
      }
    }
    expect(violazioni).toEqual([])
  })

  it('ragioneSocialeStorica compare solo nel MUD', () => {
    const fuori = file
      .map(f => path.relative(SRC, f).split(path.sep).join('/'))
      .filter(rel => !ECCEZIONI_STORICA.includes(rel))
      .filter(rel => fs.readFileSync(path.join(SRC, rel), 'utf8').includes('ragioneSocialeStorica'))
    expect(fuori).toEqual([])
  })
})
