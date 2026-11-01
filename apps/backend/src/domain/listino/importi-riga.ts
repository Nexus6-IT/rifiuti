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

export const MESSAGGIO_CASCATA =
  'Le percentuali a cascata sono al massimo tre (es. 10+5), ciascuna fino a 99,99.'

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
 * finale e' arrotondata. Senza formula lo sconto e' zero. La formula deve essere normalizzata
 * (`normalizzaCascata`): se non e' valida (`cascataValida`) lancia un errore in italiano.
 */
export function scontoCascata(importo: string, formula: string | null): string {
  if (formula === null || formula === '') return '0.00'
  if (!cascataValida(formula)) throw new Error(MESSAGGIO_CASCATA)
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

/** Numero decimale non negativo valido, normalizzato; altrimenti `null` (dato mancante o illeggibile). */
function leggiQuantita(v: string | undefined): Decimale | null {
  if (v === undefined || !/^\d+(\.\d+)?$/.test(v.trim())) return null
  return D(v.trim())
}

/**
 * Quantita' proposta da un movimento: porta fedele di `xqta` (FATAUTOMATICA.cs:16989). I pesi
 * del movimento sono in kg, il volume in litri (`umVolume: 'L'`) o metri cubi (`'M'`).
 * Come in WinWaste la conversione c'e' solo nei casi previsti e negli altri la quantita' passa
 * invariata:
 * - peso: diviso 1000 solo con `TON`; con `KG`, `GR` o qualsiasi altra unita' resta com'e'
 *   (`GR` non e' convertito: ne' il peso in grammi ne' il caso `PESO_LORDO` + `GR` sono validati
 *   qui, lo fa `validaRiga`, D10);
 * - volume: diviso 1000 solo da litri a `MC`, moltiplicato per 1000 solo da m3 a `LT`; ogni altra
 *   combinazione, anche senza `umVolume`, restituisce il volume invariato;
 * - `UNO` vale "1"; `ALTRO` non ha quantita' (`null`).
 * Unica differenza: un dato mancante o non numerico da' `null` invece di una stringa vuota.
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
      const peso = leggiQuantita(tipo === 'PESO_NETTO' ? m.netto : m.lordo)
      if (peso === null) return null
      return (um === 'TON' ? peso.div(MILLE) : peso).toFixed()
    }
    case 'VOLUME': {
      const volume = leggiQuantita(m.volume)
      if (volume === null) return null
      if (m.umVolume === 'L' && um === 'MC') return volume.div(MILLE).toFixed()
      if (m.umVolume === 'M' && um === 'LT') return volume.times(MILLE).toFixed()
      return volume.toFixed()
    }
  }
}

/**
 * Ore "h,mm" -> ore decimali: porta fedele di `cvore` (FATAUTOMATICA.cs:16965). Ore = intero
 * prima della virgola, minuti = intero dopo la virgola, senza riempimento e senza limite
 * ("1,5" = 1 ora e 5 minuti = 1.083333, "1,75" = 135 minuti = 2.25); risultato con almeno due
 * e al piu' sei decimali (`####0.00####`). Unica differenza voluta: il punto vale come la
 * virgola (il frontend manda il punto). Formato non valido -> errore.
 */
export function oreDecimali(hmm: string): string {
  const m = /^(\d+)(?:[,.](\d+))?$/.exec(hmm.trim())
  if (!m) throw new Error('Le ore si scrivono come ore,minuti (es. 1,30).')
  const minutiTotali = D(m[1])
    .times(60)
    .plus(D(m[2] ?? '0'))
  const ore = minutiTotali.div(60).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
  return prezzoCalcolato(ore.toFixed())
}
