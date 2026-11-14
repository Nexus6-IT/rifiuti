/**
 * Codifica Windows-1252 propria e pura (D6, piano 4.9c-f).
 *
 * Non si usa `latin1`: da 0x80 a 0x9F Windows-1252 differisce da ISO-8859-1 (es. `€` = 0x80,
 * `’` = 0x92, `–` = 0x96). I cinque codici 0x81, 0x8D, 0x8F, 0x90, 0x9D non sono assegnati.
 * Nessuna dipendenza esterna.
 */

/** Caratteri di 0x80-0x9F: codice byte → carattere Unicode (i 27 assegnati). */
const ALTI_CP1252: ReadonlyMap<string, number> = new Map<string, number>([
  ['€', 0x80], // €
  ['‚', 0x82], // ‚
  ['ƒ', 0x83], // ƒ
  ['„', 0x84], // „
  ['…', 0x85], // …
  ['†', 0x86], // †
  ['‡', 0x87], // ‡
  ['ˆ', 0x88], // ˆ
  ['‰', 0x89], // ‰
  ['Š', 0x8a], // Š
  ['‹', 0x8b], // ‹
  ['Œ', 0x8c], // Œ
  ['Ž', 0x8e], // Ž
  ['‘', 0x91], // ‘
  ['’', 0x92], // ’
  ['“', 0x93], // “
  ['”', 0x94], // ”
  ['•', 0x95], // •
  ['–', 0x96], // –
  ['—', 0x97], // —
  ['˜', 0x98], // ˜
  ['™', 0x99], // ™
  ['š', 0x9a], // š
  ['›', 0x9b], // ›
  ['œ', 0x9c], // œ
  ['ž', 0x9e], // ž
  ['Ÿ', 0x9f], // Ÿ
])

/** Byte di un carattere, o `undefined` se non rappresentabile in Windows-1252. */
function byteDi(carattere: string): number | undefined {
  const cp = carattere.codePointAt(0)
  if (cp === undefined) return undefined
  if (cp < 0x80) return cp
  if (cp >= 0xa0 && cp <= 0xff) return cp
  return ALTI_CP1252.get(carattere)
}

/** Caratteri distinti del testo che Windows-1252 non può rappresentare, nell'ordine di comparsa. */
export function nonRappresentabili(testo: string): string[] {
  const trovati: string[] = []
  for (const c of testo) {
    if (byteDi(c) === undefined && !trovati.includes(c)) trovati.push(c)
  }
  return trovati
}

/** True se ogni carattere del testo è rappresentabile in Windows-1252. */
export function rappresentabile(testo: string): boolean {
  return nonRappresentabili(testo).length === 0
}

/** Codifica in Windows-1252. Lancia se un carattere non è rappresentabile (va prima segnalato). */
export function codificaCp1252(testo: string): Buffer {
  const byte: number[] = []
  for (const c of testo) {
    const b = byteDi(c)
    if (b === undefined) {
      throw new RangeError(
        `Carattere non rappresentabile in Windows-1252: ${JSON.stringify(c)} (U+${(
          c.codePointAt(0) ?? 0
        )
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')})`
      )
    }
    byte.push(b)
  }
  return Buffer.from(byte)
}

/** Un campo di testo dei dati con caratteri che Windows-1252 non puo' rappresentare. */
export interface CampoNonRappresentabile {
  /** Percorso del campo nei dati, es. `righe[2].prodotto`. */
  campo: string
  caratteri: string[]
  /** Movimenti legati al campo (vedi `cercaCampiNonRappresentabili`). */
  movimentoIds: string[]
}

const PROFONDITA_MASSIMA = 12

/**
 * Cerca nei dati di un tracciato i campi di testo non rappresentabili in Windows-1252 (rete di
 * sicurezza del servizio generico: vale per ogni tracciato, anche se il preparatore non controlla).
 * Convenzione per il movimento: un oggetto con `movimentoId` (stringa) o `movimentoIds` (elenco di
 * stringhe) lo trasmette a tutti i campi che contiene, finche' un oggetto piu' interno non ne
 * dichiara un altro. Chi prepara i dati la rispetta per avere l'avviso collegato al movimento.
 */
export function cercaCampiNonRappresentabili(dati: unknown): CampoNonRappresentabile[] {
  const out: CampoNonRappresentabile[] = []
  const visita = (v: unknown, percorso: string, movimentoIds: string[], profondita: number) => {
    if (typeof v === 'string') {
      const caratteri = nonRappresentabili(v)
      if (caratteri.length > 0) out.push({ campo: percorso || '(radice)', caratteri, movimentoIds })
      return
    }
    if (v === null || typeof v !== 'object' || profondita > PROFONDITA_MASSIMA) return
    if (Array.isArray(v)) {
      v.forEach((x, i) => visita(x, `${percorso}[${i}]`, movimentoIds, profondita + 1))
      return
    }
    const o = v as Record<string, unknown>
    let ids = movimentoIds
    if (typeof o.movimentoId === 'string') ids = [o.movimentoId]
    else if (Array.isArray(o.movimentoIds) && o.movimentoIds.every(x => typeof x === 'string')) {
      ids = o.movimentoIds as string[]
    }
    for (const [k, x] of Object.entries(o)) {
      visita(x, percorso ? `${percorso}.${k}` : k, ids, profondita + 1)
    }
  }
  visita(dati, '', [], 0)
  return out
}
