/**
 * Giorni festivi per le righe TF (peso dei movimenti conferiti in giorni festivi).
 * Festivo = domenica + festività nazionali civili (L. 260/1949 e successive): 1/1, 6/1, lunedì
 * dell'Angelo, 25/4, 1/5, 2/6, 15/8, 1/11, 8/12, 25/12, 26/12 e, dal 2026, il 4/10 (festa
 * nazionale di San Francesco d'Assisi, inserita nell'art. 2 della L. 260/1949 dalla L. 8 ottobre
 * 2025 n. 151, G.U. Serie Generale n. 236 del 10/10/2025, in vigore dal 1/1/2026).
 * Il patrono del comune NON è compreso (WinWaste aveva un calendario suo; qui vale il nazionale).
 */

/** Pasqua gregoriana (algoritmo di Gauss / computus anonimo gregoriano): [mese 1-12, giorno]. */
export function pasqua(anno: number): [number, number] {
  const a = anno % 19
  const b = Math.floor(anno / 100)
  const c = anno % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mese = Math.floor((h + l - 7 * m + 114) / 31)
  const giorno = ((h + l - 7 * m + 114) % 31) + 1
  return [mese, giorno]
}

const FISSE: readonly string[] = [
  '01-01',
  '01-06',
  '04-25',
  '05-01',
  '06-02',
  '08-15',
  '11-01',
  '12-08',
  '12-25',
  '12-26',
]

/** `data` 'AAAA-MM-GG': domenica o festività nazionale. Data non valida: falso. */
export function giornoFestivo(data: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data)
  if (m === null) return false
  const [anno, mese, giorno] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(anno, mese - 1, giorno))
  if (d.getUTCFullYear() !== anno || d.getUTCMonth() !== mese - 1 || d.getUTCDate() !== giorno) {
    return false
  }
  if (d.getUTCDay() === 0) return true
  const md = `${m[2]}-${m[3]}`
  if (FISSE.includes(md)) return true
  if (md === '10-04' && anno >= 2026) return true
  const [pm, pg] = pasqua(anno)
  const pasquetta = new Date(Date.UTC(anno, pm - 1, pg + 1))
  return pasquetta.getUTCMonth() === mese - 1 && pasquetta.getUTCDate() === giorno
}
