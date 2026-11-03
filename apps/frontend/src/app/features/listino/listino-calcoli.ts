// Funzioni pure della pagina del listino del contratto. `elenchiValidiAl` e `totaleFissiAnnuo`
// sono copie di quelle del dominio del backend (`elenco-addebiti.ts`, `riga-addebito.ts`, Task 17):
// non si importano fra app, vanno tenute allineate a mano (la spec ha i casi del dominio).
import { leggiErroriAzione } from './errori-azione'

/** Data locale `YYYY-MM-DD`. */
export function oggiIso(adesso: Date = new Date()): string {
  const m = String(adesso.getMonth() + 1).padStart(2, '0')
  const g = String(adesso.getDate()).padStart(2, '0')
  return `${adesso.getFullYear()}-${m}-${g}`
}

/** "Lista non scaduti": fine vuota o non prima della data (anche gli elenchi che iniziano dopo). */
export function elenchiValidiAl<T extends { validoAl: string | null }>(
  e: readonly T[],
  data: string
): T[] {
  return e.filter(x => x.validoAl === null || x.validoAl >= data)
}

const DECIMALI = /^(\d+)(?:\.(\d+))?$/

/** Decimale non negativo esatto: intero e numero di cifre decimali (nessun troncamento). */
function esatto(v: string): { n: bigint; scala: number } | null {
  const m = DECIMALI.exec(v.trim())
  if (!m) return null
  const frazione = m[2] ?? ''
  return { n: BigInt(m[1] + frazione), scala: frazione.length }
}

/**
 * Totale annuo dei fissi (`TOTFISSI`, WinWaste `ELENCHIaddeb.cs`): solo le righe `F` e le scadenze
 * "ogni anno" (anno vuoto); somma ESATTA di quantità (vuota = 1, zero = non fatturare) x prezzo
 * (mancante = 0) x numero di scadenze, arrotondata UNA volta sola a due decimali, mezzo in su.
 * Aritmetica intera sulle stringhe, nessun troncamento né float. Copia del dominio (Task 17).
 */
export function totaleFissiAnnuo(
  righe: readonly {
    tipo: string
    quantitaFissa: string | null
    prezzo: string | null
    scadenze: readonly { anno: number | null }[]
  }[]
): string {
  // Tutti i termini portati alla stessa scala prima di sommare.
  const termini: { n: bigint; scala: number }[] = []
  for (const r of righe) {
    if (r.tipo !== 'F') continue
    const ognianno = BigInt(r.scadenze.filter(s => s.anno === null).length)
    if (ognianno === 0n) continue
    const quantita = r.quantitaFissa === null ? { n: 1n, scala: 0 } : esatto(r.quantitaFissa)
    const prezzo = r.prezzo === null ? { n: 0n, scala: 0 } : esatto(r.prezzo)
    if (quantita === null || prezzo === null) continue
    termini.push({ n: quantita.n * prezzo.n * ognianno, scala: quantita.scala + prezzo.scala })
  }
  const scala = Math.max(2, ...termini.map(t => t.scala))
  let somma = 0n
  for (const t of termini) somma += t.n * 10n ** BigInt(scala - t.scala)
  const divisore = 10n ** BigInt(scala - 2)
  const centesimi = (somma + divisore / 2n) / divisore
  return `${centesimi / 100n}.${String(centesimi % 100n).padStart(2, '0')}`
}

/**
 * Decimale in formato italiano: virgola decimale, punto delle migliaia, zeri finali tolti fino a
 * `minimoDecimali` cifre (prezzi `0.080000` -> `0,08`). Un valore che non è un decimale semplice
 * (la cascata `10+5`, vuoto) resta com'è. Il locale `it` non è registrato: niente `DecimalPipe`.
 */
export function decimaleItaliano(v: string | null | undefined, minimoDecimali = 0): string {
  if (v === null || v === undefined) return ''
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim())
  if (!m) return v
  let dec = m[3] ?? ''
  while (dec.length > minimoDecimali && dec.endsWith('0')) dec = dec.slice(0, -1)
  dec = dec.padEnd(minimoDecimali, '0')
  const intero = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${m[1]}${intero}${dec ? ',' + dec : ''}`
}

/** Sconto o provvigione in cascata (`12.5+5`): virgola decimale, come gli altri numeri. */
export function cascataItaliana(v: string | null | undefined): string {
  return v?.replace(/\./g, ',') ?? ''
}

/** Importo con due decimali: `1234.5` come `1.234,50`. */
export function importoItaliano(v: string): string {
  return decimaleItaliano(v, 2)
}

/** "la sua riga" / "le sue N righe", per il testo di conferma. */
export function righeInTesto(n: number): string {
  if (n === 0) return 'senza righe'
  return n === 1 ? 'con la sua riga' : `con le sue ${n} righe`
}

/**
 * Messaggi del backend: un 400 può avere un array in `message`, uno per riga. Un solo parser per
 * tutto il listino: `leggiErroriAzione` (voce 28, il parsing non si duplica).
 */
export function messaggiErrore(err: unknown, ripiego: string): string[] {
  return leggiErroriAzione(err, ripiego).messaggi
}
