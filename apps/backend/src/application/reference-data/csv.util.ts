/**
 * Parser CSV minimale (senza dipendenze) per i dataset di riferimento.
 * Supporta separatore configurabile e gestione base delle virgolette.
 */
export function parseCsv(text: string, separator = ';'): string[][] {
  const rows: string[][] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (line.trim() === '') continue
    rows.push(splitCsvLine(line, separator))
  }
  return rows
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}
