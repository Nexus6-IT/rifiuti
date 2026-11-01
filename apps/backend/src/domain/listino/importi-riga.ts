import { Prisma } from '@prisma/client'

/**
 * Importi della riga di un addebito (E9, E10, D13): funzioni pure su stringhe decimali con
 * aritmetica esatta (`Prisma.Decimal`), mai `number` (un double non rappresenta 0,1).
 */

type Decimale = Prisma.Decimal

const D = (v: string): Decimale => new Prisma.Decimal(v)

/** `toFixed` senza lo zero negativo ("-0.00" -> "0.00"). */
function fisso(v: Decimale, decimali: number): string {
  const testo = v.toFixed(decimali)
  return /^-0(\.0+)?$/.test(testo) ? testo.slice(1) : testo
}

/** Arrotonda a `decimali` cifre, meta' per eccesso in valore assoluto (`Format("0.00")` di VB.NET). */
export function arrotonda(v: string, decimali: number): string {
  return fisso(D(v).toDecimalPlaces(decimali, Prisma.Decimal.ROUND_HALF_UP), decimali)
}

export function arrotonda2(v: string): string {
  return arrotonda(v, 2)
}

/**
 * Forma d'uscita unica di un prezzo calcolato (R4): almeno due decimali, nessuno zero finale
 * oltre il secondo ("0.8000" -> "0.80", "0.013800" -> "0.0138").
 */
export function prezzoCalcolato(v: string): string {
  const testo = D(v).toFixed()
  const [intero, dec = ''] = testo.split('.')
  const senzaZeri = dec.replace(/0+$/, '')
  return `${intero}.${senzaZeri.padEnd(2, '0')}`
}

const TERMINE_CASCATA = /^\d{1,2}(\.\d{1,2})?$/

/**
 * Porta una cascata alla forma canonica: niente spazi, punto decimale ("10 + 5,5" -> "10+5.5").
 * Vuoto o non testuale -> null. Il valore non valido torna invariato, cosi' lo rifiuta
 * `cascataValida`.
 */
export function normalizzaCascata(f: unknown): string | null {
  if (f === null || f === undefined) return null
  const testo = (typeof f === 'number' ? String(f) : typeof f === 'string' ? f : '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
  return testo === '' ? null : testo
}

/**
 * E10, sulla forma normalizzata (punto): al massimo tre termini separati da `+`, ciascuno
 * `n`, `nn`, `n.n`, `nn.nn` (quindi fino a 99,99), nessun termine vuoto, nessun punto iniziale
 * o finale. `null` = nessuno sconto, valido.
 */
export function cascataValida(f: string | null): boolean {
  if (f === null) return true
  const termini = f.split('+')
  return termini.length <= 3 && termini.every(t => TERMINE_CASCATA.test(t))
}

/**
 * Sconto a cascata: ogni percentuale si applica al residuo (non arrotondato) e solo la somma
 * finale e' arrotondata. Senza formula lo sconto e' zero.
 */
export function scontoCascata(importo: string, formula: string | null): string {
  if (formula === null || formula === '') return '0.00'
  const base = D(importo)
  let residuo = base
  for (const termine of formula.split('+')) {
    residuo = residuo.minus(residuo.times(D(termine)).div(100))
  }
  return arrotonda2(base.minus(residuo).toFixed())
}

export function importoRiga(
  quantita: string,
  prezzo: string,
  sconto: string | null
): { lordo: string; sconto: string; netto: string } {
  const lordo = arrotonda2(D(quantita).times(D(prezzo)).toFixed())
  const scontoImporto = scontoCascata(lordo, sconto)
  return { lordo, sconto: scontoImporto, netto: D(lordo).minus(D(scontoImporto)).toFixed(2) }
}

/** Provvigione: base = lordo con `LORDO`, netto con `SCONTATO`; poi la stessa cascata. */
export function provvigioneRiga(
  i: { lordo: string; netto: string },
  formula: string | null,
  tipo: 'SCONTATO' | 'LORDO'
): string {
  return scontoCascata(tipo === 'LORDO' ? i.lordo : i.netto, formula)
}

const MILLE = new Prisma.Decimal(1000)

/**
 * Quantita' proposta da un movimento (porta di `xqta`). I pesi del movimento sono in kg e i
 * volumi in litri (`umVolume: 'L'`) o metri cubi (`'M'`). `null` se il dato manca, se l'unita'
 * non e' compatibile con la quantita' o se la quantita' e' `ALTRO`.
 */
export function quantitaDaMovimento(
  tipo: 'PESO_NETTO' | 'PESO_LORDO' | 'VOLUME' | 'UNO' | 'ALTRO',
  um: string,
  m: { netto?: string; lordo?: string; volume?: string; umVolume?: 'L' | 'M' }
): string | null {
  switch (tipo) {
    case 'UNO':
      return '1'
    case 'ALTRO':
      return null
    case 'PESO_NETTO':
    case 'PESO_LORDO': {
      const kg = tipo === 'PESO_NETTO' ? m.netto : m.lordo
      if (kg === undefined || kg === '') return null
      if (um === 'KG') return D(kg).toFixed()
      if (um === 'TON') return D(kg).div(MILLE).toFixed()
      if (um === 'GR') return D(kg).times(MILLE).toFixed()
      return null
    }
    case 'VOLUME': {
      if (m.volume === undefined || m.volume === '' || m.umVolume === undefined) return null
      const v = D(m.volume)
      if (um === 'LT') return (m.umVolume === 'L' ? v : v.times(MILLE)).toFixed()
      if (um === 'MC') return (m.umVolume === 'M' ? v : v.div(MILLE)).toFixed()
      return null
    }
  }
}

/**
 * Ore "h,mm" -> ore decimali (`cvore`): "1,30" -> "1.5", "2,45" -> "2.75". I minuti sono due
 * cifre ("1,5" vale 1 ora e 50 minuti).
 */
export function oreDecimali(hmm: string): string {
  const m = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(hmm.trim())
  if (!m) throw new Error('Le ore si scrivono come ore,minuti (es. 1,30).')
  const minuti = Number((m[2] ?? '0').padEnd(2, '0'))
  if (minuti > 59) throw new Error('I minuti vanno da 00 a 59.')
  return D(m[1])
    .plus(D(String(minuti)).div(60))
    .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed()
}
