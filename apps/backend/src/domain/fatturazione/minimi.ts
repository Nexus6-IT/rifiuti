import { Prisma } from '@prisma/client'
import type { EsitoRighe, RigaSenzaLinea } from './esito-righe'
import type { RigaListinoDaFatturare } from './tipi'

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v)
const DESCRIZIONE = 'Differenza per minimo fatturabile'

/** Tipi di riga che entrano nei confronti dei minimi (a prezzo normale: niente fasce speciali). */
const TIPI_NEL_MINIMO: ReadonlySet<string> = new Set(['MOVIMENTO', 'FISSO', 'QUANTITA_MOVIMENTI'])

function somma(righe: readonly RigaSenzaLinea[]): Prisma.Decimal {
  return righe.reduce((s, r) => s.plus(D(r.prezzoTotale)), D('0'))
}

function rigaMinimo(m: RigaListinoDaFatturare, differenza: Prisma.Decimal): RigaSenzaLinea {
  const diff = differenza.toFixed(2)
  return {
    tipoRiga: 'MINIMO',
    legameId: null,
    rigaLegameId: null,
    rigaAddebitoId: m.id,
    descrizione: DESCRIZIONE,
    dataMovimento: null,
    cerCode: null,
    numeroFir: null,
    quantita: '1',
    unitaMisura: m.unitaMisura,
    prezzoUnitario: diff,
    sconto: null,
    importoLordo: diff,
    importoSconto: '0.00',
    prezzoTotale: diff,
    codiceIvaId: m.codiceIva.id,
    aliquotaIva: m.codiceIva.aliquota,
    naturaIva: m.codiceIva.natura,
  }
}

/**
 * Minimi (spec §6.5): minimo di riga (`minimo_fatturabile`, anche per categoria) e righe `MW`,
 * `MF`, `M<cat>` in `minimi`. Restituisce solo le righe aggiunte (tipo MINIMO). `listino` mappa
 * `rigaAddebitoId` -> riga di listino. Per `MW`/`MF`/`M<cat>` la soglia è il `prezzo` della riga
 * (con ripiego su `minimoFatturabile`); la categoria di una riga è la `categoriaId` della sua
 * riga di listino, confrontata con le tre cifre di `M<cat>`.
 */
export function applicaMinimi(
  righe: readonly RigaSenzaLinea[],
  minimi: readonly RigaListinoDaFatturare[],
  listino: ReadonlyMap<string, RigaListinoDaFatturare>
): EsitoRighe {
  const aggiunte: RigaSenzaLinea[] = []
  const categoria = (r: RigaSenzaLinea): string | null =>
    r.rigaAddebitoId === null ? null : (listino.get(r.rigaAddebitoId)?.categoriaId ?? null)
  const normali = righe.filter(r => TIPI_NEL_MINIMO.has(r.tipoRiga))

  // Minimo di riga: una sola volta per riga di listino (o per categoria con minimo_per_categoria).
  const visti = new Set<string>()
  for (const r of listino.values()) {
    if (r.minimoFatturabile === null || visti.has(r.id)) continue
    const dellaRiga = normali.filter(x => x.rigaAddebitoId === r.id)
    if (dellaRiga.length === 0) continue
    let netto: Prisma.Decimal
    if (r.minimoPerCategoria && r.categoriaId !== null) {
      netto = somma(normali.filter(x => categoria(x) === r.categoriaId))
      for (const altra of listino.values()) {
        if (altra.minimoPerCategoria && altra.categoriaId === r.categoriaId) visti.add(altra.id)
      }
    } else {
      netto = somma(dellaRiga)
    }
    visti.add(r.id)
    const minimo = D(r.minimoFatturabile)
    if (netto.lt(minimo)) aggiunte.push(rigaMinimo(r, minimo.minus(netto)))
  }

  // Minimi di documento: MW (tutto), MF (righe CER), M<cat> (righe della categoria).
  const base = [...normali, ...aggiunte]
  for (const m of minimi) {
    const soglia = m.prezzo ?? m.minimoFatturabile
    if (soglia === null) continue
    let insieme: readonly RigaSenzaLinea[]
    if (m.tipo === 'MW') insieme = base
    else if (m.tipo === 'MF') {
      insieme = base.filter(
        r => r.rigaAddebitoId !== null && listino.get(r.rigaAddebitoId)?.tipo === 'CER'
      )
    } else if (/^M\d{3}$/.test(m.tipo)) {
      insieme = base.filter(r => categoria(r) === m.tipo.slice(1))
    } else continue
    const totale = somma(insieme)
    if (totale.lt(D(soglia))) aggiunte.push(rigaMinimo(m, D(soglia).minus(totale)))
  }
  return { righe: aggiunte, errori: [], avvisi: [] }
}
