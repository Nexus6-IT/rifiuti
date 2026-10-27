import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..', '..', '..')

/**
 * Guardia statica sulle costanti delle causali (Fase 2 pezzo 5, C8).
 *
 * Le causali del registro sono dati (catalogo di sistema + personalizzazioni dell'azienda): le
 * vecchie costanti e mappe nel codice non devono rinascere, altrimenti ci sarebbero di nuovo due
 * fonti di verità. Si cercano solo le DICHIARAZIONI (`const`, `function`, `type`, `enum`,
 * `export` sulla stessa riga del nome) nei `.ts` non spec di `apps/backend/src`, dopo aver tolto
 * i commenti: un commento che cita il vecchio nome non fa fallire il test.
 *
 * Ogni task aggiunge a `NOMI_RIMOSSI` solo i nomi che rimuove: il Task 3 quelli del MUD, il
 * Task 4a quelli del registro (`CAUSALI_CARICO`, `CAUSALI_SCARICO`, `ALL_CAUSALI`,
 * `CausaleCarico`, `CausaleScarico`, `CausaleMovimento`).
 *
 * Limite noto: `senzaCommenti` non gestisce gli apici dentro una regex literal.
 */
const NOMI_RIMOSSI = [
  'RUOLO_CARICO',
  'RUOLO_SCARICO',
  'operazioneDaCausale',
  'CAUSALI_CARICO',
  'CAUSALI_SCARICO',
  'ALL_CAUSALI',
  'CausaleCarico',
  'CausaleScarico',
  'CausaleMovimento',
]

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return sorgenti(percorso)
    return nome.endsWith('.ts') && !nome.endsWith('.spec.ts') ? [percorso] : []
  })
}

/** Toglie i commenti rispettando le stringhe e i template. */
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

/** Nomi vietati dichiarati nel sorgente (commenti esclusi). */
function dichiarati(testo: string, nomi: string[]): string[] {
  const codice = senzaCommenti(testo)
  return nomi.filter(nome =>
    new RegExp(`\\b(const|function|type|enum|export)\\b[^\\n]*\\b${nome}\\b`).test(codice)
  )
}

describe('costanti delle causali: guardia statica', () => {
  it('nessun sorgente dichiara i nomi rimossi', () => {
    const trovati: Record<string, string[]> = {}
    for (const file of sorgenti(SRC)) {
      const d = dichiarati(readFileSync(file, 'utf8'), NOMI_RIMOSSI)
      if (d.length > 0) trovati[relative(SRC, file).split(sep).join('/')] = d
    }
    expect(trovati).toEqual({})
  })

  it('fallisce su un sorgente finto che dichiara il vecchio nome', () => {
    expect(dichiarati("const RUOLO_CARICO = { X: 'PRODOTTO' }", NOMI_RIMOSSI)).toEqual([
      'RUOLO_CARICO',
    ])
    expect(dichiarati('export function operazioneDaCausale(c: string) {}', NOMI_RIMOSSI)).toEqual([
      'operazioneDaCausale',
    ])
  })

  it('fallisce su un sorgente finto con i nomi del registro', () => {
    expect(dichiarati('export const CAUSALI_CARICO = [\x27X\x27] as const', NOMI_RIMOSSI)).toEqual([
      'CAUSALI_CARICO',
    ])
    expect(dichiarati('export type CausaleMovimento = string', NOMI_RIMOSSI)).toEqual([
      'CausaleMovimento',
    ])
  })

  it('non fallisce se il nome compare solo in un commento', () => {
    const testo = [
      '// const RUOLO_CARICO = {} era la vecchia mappa',
      '/* export function operazioneDaCausale() {} */',
      '/** RUOLO_SCARICO: ora nel catalogo */',
      'export const altro = 1',
    ].join('\n')
    expect(dichiarati(testo, NOMI_RIMOSSI)).toEqual([])
  })
})
