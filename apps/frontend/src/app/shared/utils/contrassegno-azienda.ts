/**
 * Contrassegno dell'azienda attiva: iniziali su un colore fisso per azienda.
 *
 * Serve a chi lavora su più aziende (consulente, gruppo con aziende madre e
 * figlie) per riconoscere a colpo d'occhio in quale azienda sta registrando:
 * l'errore più grave per quella persona è un movimento nell'azienda sbagliata.
 *
 * Il colore dipende dall'id del tenant, non dal nome, così resta lo stesso se
 * la ragione sociale cambia. Tutti i colori reggono il testo bianco (contrasto
 * almeno 4.5:1) e sono distinti dagli stati semantici (verde/ambra/rosso pieni)
 * e dal teal del brand.
 */

export const COLORI_CONTRASSEGNO = [
  '#2f6b4f',
  '#8a3b5c',
  '#3b5ba8',
  '#9a5a16',
  '#5b4b9a',
  '#1f6e7a',
  '#8a4b2e',
  '#4e5563',
] as const

export interface ContrassegnoAzienda {
  iniziali: string
  colore: (typeof COLORI_CONTRASSEGNO)[number]
}

/** Forme giuridiche da non usare per le iniziali (già senza punti). */
const FORME_GIURIDICHE = new Set([
  'srl',
  'srls',
  'spa',
  'snc',
  'sas',
  'sapa',
  'scarl',
  'scrl',
  'coop',
  'ss',
])

export function inizialiAzienda(nome: string | null | undefined): string {
  const parole = (nome ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(p => p && !FORME_GIURIDICHE.has(p))
  if (parole.length >= 2) return (parole[0][0] + parole[1][0]).toUpperCase()
  if (parole.length === 1) return parole[0].slice(0, 2).toUpperCase()
  return 'AZ'
}

/** Hash djb2: deterministico e sufficiente a spargere gli id sulla tavolozza. */
function hash(testo: string): number {
  let h = 5381
  for (let i = 0; i < testo.length; i++) h = ((h << 5) + h + testo.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function contrassegnoAzienda(
  id: string | null | undefined,
  nome: string | null | undefined
): ContrassegnoAzienda {
  const chiave = id || nome || ''
  return {
    iniziali: inizialiAzienda(nome),
    colore: COLORI_CONTRASSEGNO[hash(chiave) % COLORI_CONTRASSEGNO.length],
  }
}
