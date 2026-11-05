/**
 * Normalizzatore dei testi per l'XML FatturaPA (Task 15, spec §7.2, S11).
 *
 * L'XSD (`String1LatinType` e simili, Specifiche tecniche FatturaPA 1.2.x, fatturapa.gov.it)
 * ammette solo Basic Latin e Latin-1 Supplement: un carattere fuori da quell'insieme fa scartare
 * il file dallo SDI. Qui si traslittera e poi si tronca alla lunghezza dell'XSD.
 *
 * Scelta: delle lettere con segno diacritico si conservano solo le vocali accentate italiane
 * (àèéìòù e maiuscole). Le altre (ó, ü, å, ç...) diventano la lettera base: "Łódź" -> "Lodz"
 * (requisito del brief). Tutto il resto di Latin-1 (simboli come ° ± £ §) resta.
 */

const SOSTITUZIONI: Readonly<Record<string, string>> = {
  '€': 'EUR',
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '«': '"',
  '»': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '`': "'",
  '´': "'",
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
  Æ: 'AE',
  æ: 'ae',
  Œ: 'OE',
  œ: 'oe',
  Ð: 'D',
  ð: 'd',
  Þ: 'Th',
  þ: 'th',
  ß: 'ss',
  Ø: 'O',
  ø: 'o',
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  ı: 'i',
}

const ITALIANE = new Set('àèéìòùÀÈÉÌÒÙ')

function emettiCarattere(c: string): string {
  const cp = c.codePointAt(0) as number
  if (cp <= 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0xa0)) return ' ' // spazi e controlli
  if (cp < 0x7f) return c
  const sost = SOSTITUZIONI[c]
  if (sost !== undefined) return sost
  if (ITALIANE.has(c)) return c
  const isLatin1 = cp <= 0xff
  const isLettera = /\p{L}/u.test(c)
  if (isLatin1 && !isLettera) return c // simboli Latin-1 ammessi
  // Lettera con segni (o fuori Latin-1): scomposizione e tolta dei segni combinanti.
  const base = c.normalize('NFD').replace(/\p{M}/gu, '')
  if (base.length > 0 && /^[\x20-\x7e]+$/.test(base)) return base
  return '' // emoji, CJK, simboli non rappresentabili
}

/**
 * Traslittera in Basic Latin + Latin-1, riduce gli spazi (anche a capo e tabulazioni) a uno,
 * toglie gli spazi ai bordi e poi tronca a `lunghezzaMassima` (senza spazio finale).
 */
export function normalizzaTesto(s: string, lunghezzaMassima: number): string {
  let uscita = ''
  for (const c of s) uscita += emettiCarattere(c)
  const pulito = uscita.replace(/ +/g, ' ').trim()
  return pulito.slice(0, lunghezzaMassima).trimEnd()
}
