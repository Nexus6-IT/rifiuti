import { inflateSync } from 'zlib'

/**
 * Testo di un PDF prodotto da pdfmake/pdfkit, senza dipendenze: i font sono sottoinsiemi Type0
 * (Identity-H), quindi il testo sta nei content stream come codici di glifo; si decodifica con la
 * mappa `ToUnicode` di ciascun font. Serve a verificare il CONTENUTO di una copia di cortesia
 * (es. la riga «Storno della fattura N. ...») senza aggiungere una libreria di lettura dei PDF.
 */
interface Oggetto {
  dizionario: string
  flusso: Buffer | null
}

function leggiOggetti(pdf: Buffer): Map<number, Oggetto> {
  const testo = pdf.toString('latin1')
  const oggetti = new Map<number, Oggetto>()
  const re = /(\d+) 0 obj\s*([\s\S]*?)endobj/g
  for (let m = re.exec(testo); m !== null; m = re.exec(testo)) {
    const corpo = m[2]
    const inizio = corpo.indexOf('stream')
    let dizionario = corpo
    let flusso: Buffer | null = null
    if (inizio >= 0) {
      dizionario = corpo.slice(0, inizio)
      const dati = Buffer.from(
        corpo.slice(inizio + 'stream'.length).replace(/^\r?\n/, ''),
        'latin1'
      )
      const fine = dati.lastIndexOf('endstream', undefined, 'latin1')
      const grezzo = fine >= 0 ? dati.subarray(0, fine) : dati
      try {
        flusso = /FlateDecode/.test(dizionario) ? inflateSync(grezzo) : grezzo
      } catch {
        flusso = null
      }
    }
    oggetti.set(Number(m[1]), { dizionario, flusso })
  }
  return oggetti
}

const daEsadecimale = (h: string): number[] => {
  const n: number[] = []
  for (let i = 0; i + 3 < h.length + 1; i += 4) n.push(parseInt(h.slice(i, i + 4), 16))
  return n
}

/** Mappa codice di glifo -> testo, dal CMap `ToUnicode` (bfchar e bfrange). */
function leggiCmap(cmap: string): Map<number, string> {
  const mappa = new Map<number, string>()
  const unicode = (h: string) => String.fromCharCode(...daEsadecimale(h.padStart(4, '0')))
  for (const blocco of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of blocco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      mappa.set(parseInt(r[1], 16), unicode(r[2]))
    }
  }
  for (const blocco of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // `<da> <a> <base>` oppure `<da> <a> [<c1> <c2> ...]` (la forma che usa pdfkit).
    for (const r of blocco[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g
    )) {
      const da = parseInt(r[1], 16)
      const a = parseInt(r[2], 16)
      if (r[4] !== undefined) {
        const voci = [...r[4].matchAll(/<([0-9a-fA-F]+)>/g)].map(x => unicode(x[1]))
        voci.forEach((v, i) => mappa.set(da + i, v))
      } else {
        const base = daEsadecimale(r[3].padStart(4, '0'))[0]
        for (let c = da; c <= a; c++) mappa.set(c, String.fromCharCode(base + c - da))
      }
    }
  }
  return mappa
}

/** Testo del PDF, una riga per operatore di testo, nell'ordine dei content stream. */
export function testoPdf(pdf: Buffer): string {
  const oggetti = leggiOggetti(pdf)
  const cmapPerFont = new Map<number, Map<number, string>>()
  for (const [id, o] of oggetti) {
    const tu = /\/ToUnicode (\d+) 0 R/.exec(o.dizionario)
    if (tu) {
      const flusso = oggetti.get(Number(tu[1]))?.flusso
      if (flusso) cmapPerFont.set(id, leggiCmap(flusso.toString('latin1')))
    }
  }
  // Nomi dei font nelle risorse (`/F1 9 0 R`): in pdfkit sono unici nel documento.
  const fontPerNome = new Map<string, number>()
  for (const o of oggetti.values()) {
    for (const m of o.dizionario.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      fontPerNome.set(m[1], Number(m[2]))
    }
  }
  const righe: string[] = []
  for (const o of oggetti.values()) {
    if (!o.flusso || !/\bTf\b/.test(o.flusso.toString('latin1'))) continue
    let cmap: Map<number, string> | undefined
    const re = /\/(F\d+) [\d.]+ Tf|\[((?:[^\]]*))\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g
    const contenuto = o.flusso.toString('latin1')
    for (let m = re.exec(contenuto); m !== null; m = re.exec(contenuto)) {
      if (m[1]) {
        cmap = cmapPerFont.get(fontPerNome.get(m[1]) ?? -1)
        continue
      }
      if (!cmap) continue
      const esa =
        m[3] !== undefined ? [m[3]] : [...m[2].matchAll(/<([0-9a-fA-F]+)>/g)].map(x => x[1])
      righe.push(
        esa
          .map(h =>
            daEsadecimale(h)
              .map(c => cmap?.get(c) ?? '')
              .join('')
          )
          .join('')
      )
    }
  }
  return righe.join('\n')
}
