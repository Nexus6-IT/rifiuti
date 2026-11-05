import { Prisma } from '@prisma/client'
import { arrotonda2 } from '../listino/importi-riga'
import type { AvvisoDocumento, ErroreDocumento, Segnalazione } from './codici'
import {
  importoBolloAl,
  NATURE_NON_AMMESSE,
  NATURE_SOGGETTE_BOLLO,
  SOGLIA_BOLLO,
} from './costanti-fiscali'
import type { CodiceIvaDaFatturare, RigaDocumentoCalcolata, RiepilogoIvaCalcolato } from './tipi'

/** Riga calcolata senza il numero di linea, che assegna il chiamante. */
export type RigaSenzaNumero = Omit<RigaDocumentoCalcolata, 'numeroLinea'>

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v)
const LUNGHEZZA_RIFERIMENTO_NORMATIVO = 100

/**
 * Riepilogo IVA (spec §6.7): imponibile per coppia (aliquota, natura), imposta arrotondata
 * sul totale della coppia e non sulla somma delle imposte di riga. Le nature generiche
 * N2, N3 e N6 danno NATURA_NON_AMMESSA (una sola segnalazione per natura).
 */
export function riepiloghiIva(
  righe: readonly RigaDocumentoCalcolata[],
  esigibilita: 'I' | 'D' | 'S',
  codiciIva: ReadonlyMap<string, CodiceIvaDaFatturare>
): { riepiloghi: RiepilogoIvaCalcolato[]; errori: Segnalazione<ErroreDocumento>[] } {
  const gruppi = new Map<
    string,
    { aliquota: string; natura: string | null; imponibile: Prisma.Decimal; codiceIvaId: string }
  >()
  const errori: Segnalazione<ErroreDocumento>[] = []
  const naturePrese = new Set<string>()

  for (const r of righe) {
    if (r.naturaIva !== null && NATURE_NON_AMMESSE.includes(r.naturaIva)) {
      if (!naturePrese.has(r.naturaIva)) {
        naturePrese.add(r.naturaIva)
        errori.push({ codice: 'NATURA_NON_AMMESSA', dettaglio: r.naturaIva })
      }
    }
    const chiave = `${D(r.aliquotaIva).toFixed()}|${r.naturaIva ?? ''}`
    const g = gruppi.get(chiave)
    if (g) g.imponibile = g.imponibile.plus(D(r.prezzoTotale))
    else {
      gruppi.set(chiave, {
        aliquota: r.aliquotaIva,
        natura: r.naturaIva,
        imponibile: D(r.prezzoTotale),
        codiceIvaId: r.codiceIvaId,
      })
    }
  }

  const riepiloghi: RiepilogoIvaCalcolato[] = [...gruppi.values()].map(g => {
    const imponibile = g.imponibile.toFixed(2)
    const descrizione = codiciIva.get(g.codiceIvaId)?.descrizione ?? null
    return {
      aliquota: g.aliquota,
      natura: g.natura,
      imponibile,
      imposta: arrotonda2(g.imponibile.times(D(g.aliquota)).div(100).toFixed()),
      esigibilita,
      riferimentoNormativo:
        descrizione === null ? null : descrizione.slice(0, LUNGHEZZA_RIFERIMENTO_NORMATIVO),
    }
  })
  return { riepiloghi, errori }
}

/**
 * Bollo (spec §6.9). Dovuto se la somma degli imponibili con natura soggetta supera la soglia.
 * La base si calcola sui riepiloghi PRIMA di aggiungere la riga BOLLO (che ha natura N1):
 * il chiamante non deve ripassare i riepiloghi che includono il bollo stesso.
 * La riga BOLLO ha come importo quello della spesa di bollo del contratto.
 */
export function valutaBollo(
  riepiloghi: readonly RiepilogoIvaCalcolato[],
  dataDocumento: string,
  spesaBollo: { importo: string; codiceIva: CodiceIvaDaFatturare | null } | null
): {
  dovuto: boolean
  importo: string | null
  rigaBollo: RigaSenzaNumero | null
  errori: Segnalazione<ErroreDocumento>[]
  avvisi: Segnalazione<AvvisoDocumento>[]
} {
  const base = riepiloghi
    .filter(r => r.natura !== null && NATURE_SOGGETTE_BOLLO.includes(r.natura))
    .reduce((s, r) => s.plus(D(r.imponibile)), new Prisma.Decimal(0))
  const dovuto = base.greaterThan(D(SOGLIA_BOLLO))
  const vuoto = { dovuto, importo: null, rigaBollo: null, errori: [], avvisi: [] }
  if (!dovuto) return { ...vuoto, dovuto: false }

  const importo = importoBolloAl(dataDocumento)
  if (spesaBollo === null || D(spesaBollo.importo).isZero()) {
    return { ...vuoto, importo, avvisi: [{ codice: 'BOLLO_NON_ADDEBITATO' }] }
  }
  if (spesaBollo.codiceIva === null) {
    return { ...vuoto, importo, errori: [{ codice: 'SPESA_SENZA_CODICE_IVA', dettaglio: 'bollo' }] }
  }
  const iva = spesaBollo.codiceIva
  if (iva.natura !== 'N1') {
    return {
      ...vuoto,
      importo,
      errori: [
        { codice: 'NATURA_NON_AMMESSA', dettaglio: 'bollo: serve un codice IVA con natura N1' },
      ],
    }
  }
  const prezzo = arrotonda2(spesaBollo.importo)
  return {
    dovuto,
    importo,
    rigaBollo: rigaSpesa('BOLLO', 'Bollo', prezzo, '1.00', iva),
    errori: [],
    avvisi: [],
  }
}

function rigaSpesa(
  tipoRiga: 'BOLLO' | 'SPESA_INCASSO',
  descrizione: string,
  totale: string,
  quantita: string,
  iva: CodiceIvaDaFatturare
): RigaSenzaNumero {
  const unitario = arrotonda2(D(totale).div(D(quantita)).toFixed())
  return {
    tipoRiga,
    legameId: null,
    rigaLegameId: null,
    rigaAddebitoId: null,
    descrizione,
    dataMovimento: null,
    cerCode: null,
    numeroFir: null,
    quantita,
    unitaMisura: null,
    prezzoUnitario: unitario,
    sconto: null,
    importoLordo: totale,
    importoSconto: '0.00',
    prezzoTotale: totale,
    codiceIvaId: iva.id,
    aliquotaIva: iva.aliquota,
    naturaIva: iva.natura,
  }
}

/**
 * Spese di incasso (spec §6.8, S15): importo della spesa per il numero delle rate, una sola riga.
 * Importo zero o nessuna spesa: nessuna riga.
 */
export function rigaSpeseIncasso(
  spesa: { descrizione: string; importo: string; codiceIva: CodiceIvaDaFatturare | null } | null,
  numeroRate: number
): { riga: RigaSenzaNumero | null; errori: Segnalazione<ErroreDocumento>[] } {
  if (spesa === null) return { riga: null, errori: [] }
  const totale = D(spesa.importo).times(numeroRate)
  if (totale.isZero()) return { riga: null, errori: [] }
  if (spesa.codiceIva === null) {
    return { riga: null, errori: [{ codice: 'SPESA_SENZA_CODICE_IVA' }] }
  }
  return {
    riga: rigaSpesa(
      'SPESA_INCASSO',
      spesa.descrizione,
      arrotonda2(totale.toFixed()),
      String(numeroRate) + '.00',
      spesa.codiceIva
    ),
    errori: [],
  }
}
