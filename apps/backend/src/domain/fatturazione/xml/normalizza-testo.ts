/**
 * Normalizzatore dei testi per l'XML FatturaPA (Task 15, spec §7.2, S11).
 *
 * L'XSD (Specifiche tecniche FatturaPA 1.2.x, fatturapa.gov.it) ha due famiglie di stringhe:
 * - `String*LatinType`: pattern `[\p{IsBasicLatin}\p{IsLatin-1Supplement}]` (insieme `LATIN1`);
 * - `String*Type` (Numero, IdDocumento, CUP, CIG, NumeroREA, UnitaMisura, ...): solo
 *   `\p{IsBasicLatin}` (insieme `BASIC`).
 * Un carattere fuori dall'insieme fa scartare il file dallo SDI. Qui si traslittera, si riducono
 * gli spazi e poi si tronca alla lunghezza dell'XSD.
 */

export type InsiemeCaratteri = 'LATIN1' | 'BASIC'

/** Sostituzioni per i caratteri fuori da Latin-1 (e per la tipografia da ricondurre ad ASCII). */
const SOSTITUZIONI: Readonly<Record<string, string>> = {
  '€': 'EUR',
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '–': '-',
  '—': '-',
  '―': '-',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '−': '-',
  '…': '...',
  '•': '-',
  '™': 'TM',
  Œ: 'OE',
  œ: 'oe',
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i',
}

/** Da Latin-1 a Basic Latin (campi `String*Type`). `º` e `°` diventano il punto: «n° 45» -> «n. 45». */
const LATIN1_A_BASIC: Readonly<Record<string, string>> = {
  '°': '.',
  º: '.',
  ª: 'a',
  '¹': '1',
  '²': '2',
  '³': '3',
  µ: 'u',
  '×': 'x',
  '÷': '/',
  '±': '+/-',
  '«': '"',
  '»': '"',
  '¦': '|',
  '¬': '-',
  '·': '.',
  Æ: 'AE',
  æ: 'ae',
  Ð: 'D',
  ð: 'd',
  Þ: 'Th',
  þ: 'th',
  ß: 'ss',
  Ø: 'O',
  ø: 'o',
}

function conSegniTolti(c: string): string {
  return c.normalize('NFD').replace(/\p{M}/gu, '')
}

function emettiLatin1(c: string): string {
  const cp = c.codePointAt(0) as number
  if (cp <= 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0xa0)) return ' ' // spazi e controlli
  if (cp === 0xad) return '' // trattino morbido: invisibile
  if (cp < 0x7f) return c
  if (cp <= 0xff) return c // Latin-1 Supplement ammesso
  const sost = SOSTITUZIONI[c]
  if (sost !== undefined) return sost
  // Lettera con segni oltre Latin-1 (ź, ř, ...): scomposta e ricomposta; si tiene se sta in Latin-1.
  const ricomposto = c.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
  if (ricomposto.length > 0 && [...ricomposto].every(x => (x.codePointAt(0) as number) <= 0xff)) {
    return ricomposto
  }
  return '' // emoji, CJK, simboli non rappresentabili
}

function emettiBasic(c: string): string {
  const l1 = emettiLatin1(c)
  let out = ''
  for (const x of l1) {
    const cp = x.codePointAt(0) as number
    if (cp < 0x7f) {
      out += x
      continue
    }
    const m = LATIN1_A_BASIC[x]
    if (m !== undefined) {
      out += m
      continue
    }
    const base = conSegniTolti(x)
    if (/^[\x20-\x7e]+$/.test(base)) out += base // à -> a, ç -> c, ...
    // altro (simboli di valuta, frazioni, ...): tolto
  }
  return out
}

/**
 * Traslittera nell'insieme richiesto (`LATIN1` di default), riduce gli spazi (anche a capo e
 * tabulazioni) a uno, toglie gli spazi ai bordi e tronca a `lunghezzaMassima` (senza spazio finale).
 */
export function normalizzaTesto(
  s: string,
  lunghezzaMassima: number,
  insieme: InsiemeCaratteri = 'LATIN1'
): string {
  let uscita = ''
  const emetti = insieme === 'BASIC' ? emettiBasic : emettiLatin1
  for (const c of s) uscita += emetti(c)
  const pulito = uscita.replace(/ +/g, ' ').trim()
  return pulito.slice(0, lunghezzaMassima).trimEnd()
}
