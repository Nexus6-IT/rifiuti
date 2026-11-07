import { Prisma } from '@prisma/client'
import type { ErroreDocumento, Segnalazione } from './codici'
import { FORMA_MINIMO_CATEGORIA } from './costanti-fiscali'
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
    unitaMisura: null,
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
 * `MF`, `M<cat>` in `minimi`. Restituisce solo le righe aggiunte (tipo MINIMO, senza unità di
 * misura). `listino` mappa `rigaAddebitoId` -> riga di listino. La soglia di `MW`/`MF`/`M<cat>`
 * è il `prezzo` della riga (la famiglia MINIMO non ha `minimoFatturabile`); senza prezzo dà
 * RIGA_LEGAME_INCOMPLETA con dettaglio «<tipo>» e `rigaId` (la posizione la scrive `calcolaDocumento`).
 *
 * Insiemi (WinWaste `docs/fatturazione.md` §4.6, codice `:12444-12579`, e `etichettaTipo`):
 * `MW` = tutto il documento a prezzo normale; `MF` = righe CER; `M<cat>` = righe di tipo `V` della
 * categoria, confrontando le 3 cifre con `categoriaCodice` (non con `categoriaId`, che è un uuid).
 * Minimo per categoria (`minimoPerCategoria`): raggruppa per `categoriaId`; se le righe della
 * categoria hanno minimi diversi vale il più alto.
 */
export function applicaMinimi(
  righe: readonly RigaSenzaLinea[],
  minimi: readonly RigaListinoDaFatturare[],
  listino: ReadonlyMap<string, RigaListinoDaFatturare>
): EsitoRighe {
  const aggiunte: RigaSenzaLinea[] = []
  const errori: Segnalazione<ErroreDocumento>[] = []
  const voce = (r: RigaSenzaLinea): RigaListinoDaFatturare | undefined =>
    r.rigaAddebitoId === null ? undefined : listino.get(r.rigaAddebitoId)
  const normali = righe.filter(r => TIPI_NEL_MINIMO.has(r.tipoRiga))

  // Minimo di riga: per riga di listino, o per categoria (uuid) con minimo_per_categoria.
  const gruppiCategoria = new Map<string, RigaListinoDaFatturare>()
  for (const r of listino.values()) {
    if (r.minimoFatturabile === null) continue
    if (r.minimoPerCategoria && r.categoriaId !== null) {
      const attuale = gruppiCategoria.get(r.categoriaId)
      if (attuale === undefined || D(r.minimoFatturabile).gt(D(attuale.minimoFatturabile ?? '0'))) {
        gruppiCategoria.set(r.categoriaId, r)
      }
      continue
    }
    const dellaRiga = normali.filter(x => x.rigaAddebitoId === r.id)
    if (dellaRiga.length === 0) continue
    const minimo = D(r.minimoFatturabile)
    const netto = somma(dellaRiga)
    if (netto.lt(minimo)) aggiunte.push(rigaMinimo(r, minimo.minus(netto)))
  }
  for (const [categoriaId, r] of gruppiCategoria) {
    const dellaCategoria = normali.filter(x => voce(x)?.categoriaId === categoriaId)
    if (dellaCategoria.length === 0) continue
    const minimo = D(r.minimoFatturabile ?? '0')
    const netto = somma(dellaCategoria)
    if (netto.lt(minimo)) aggiunte.push(rigaMinimo(r, minimo.minus(netto)))
  }

  // Minimi di documento: la base è copiata una volta, i minimi non si sommano fra loro.
  const base = [...normali, ...aggiunte]
  minimi.forEach(m => {
    let insieme: readonly RigaSenzaLinea[]
    if (m.tipo === 'MW') insieme = base
    else if (m.tipo === 'MF') insieme = base.filter(r => voce(r)?.tipo === 'CER')
    else if (FORMA_MINIMO_CATEGORIA.test(m.tipo)) {
      insieme = base.filter(r => {
        const v = voce(r)
        return v?.tipo === 'V' && v.categoriaCodice === m.tipo.slice(1)
      })
    } else return
    if (m.prezzo === null) {
      errori.push({
        codice: 'RIGA_LEGAME_INCOMPLETA',
        dettaglio: m.tipo,
        rigaId: m.id,
      })
      return
    }
    const soglia = D(m.prezzo)
    const totale = somma(insieme)
    if (totale.lt(soglia)) aggiunte.push(rigaMinimo(m, soglia.minus(totale)))
  })
  return { righe: aggiunte, errori, avvisi: [] }
}
