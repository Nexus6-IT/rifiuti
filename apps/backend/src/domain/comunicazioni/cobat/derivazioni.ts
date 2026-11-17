/**
 * Regole pure del COBAT (D10 e piano 4.9c-f, B3). Tabella WinWaste `OPER` -> termini WasteFlow
 * (`movimenti.md §2.4`, `ComuCou:cobtipmov:2540`, `cobcausa:2582`):
 *
 * | WinWaste OPER                         | WasteFlow                                  | tipmov |
 * |---------------------------------------|--------------------------------------------|--------|
 * | 10, 22 (carico di produzione)         | CARICO, ruolo PRODOTTO                     | 2      |
 * | 20 (carico da terzi)                  | CARICO, ruolo RICEVUTO_DA_TERZI            | 3 / 6* |
 * | 11-13, 15, 16, 23, 24, 26, 28 (scarico) | SCARICO, ruolo AVVIATO                   | 4 / 7* |
 * | 14, 21, 25, 27 (trattamento interno)  | solo per forzatura                         | 5      |
 * | 30 (trasporto conto terzi)            | solo per forzatura                         | 1      |
 *
 * (*) 6 e 7 se il trasportatore non siamo noi.
 */
import type { DatiCobat } from '../dati-tracciato'

export type RuoloCobat = 'PRODOTTO' | 'AVVIATO' | 'RICEVUTO_DA_TERZI' | 'ESCLUSO'

export interface InputTipoMovimento {
  verso: 'CARICO' | 'SCARICO'
  ruolo: RuoloCobat
  /** Il trasportatore del FIR non e' l'azienda (CF o P.IVA diversi da quelli del tenant). */
  trasportatoreEsterno: boolean
  forzatura?: DatiCobat['tipoMovimento'] | null
}

/** `tipmov` (1 carattere). `null` se non determinabile: la forzatura nei dati del movimento vince. */
export function tipoMovimentoCobat(i: InputTipoMovimento): number | null {
  if (i.forzatura) return i.forzatura
  if (i.verso === 'CARICO') {
    if (i.ruolo === 'PRODOTTO') return 2
    if (i.ruolo === 'RICEVUTO_DA_TERZI') return i.trasportatoreEsterno ? 6 : 3
    return null
  }
  if (i.ruolo === 'AVVIATO') return i.trasportatoreEsterno ? 7 : 4
  return null
}

const D_TRE = new Set([1, 3, 4, 5, 6, 7, 12])
const D_QUATTRO = new Set([2, 8, 9, 10, 11, 13, 14])

export interface InputCausa {
  verso: 'CARICO' | 'SCARICO'
  ruolo: RuoloCobat
  /** Codice R/D completo (`R13`, `D15`...), se indicato. */
  operationCode: string | null
  /** `R` o `D` quando il codice completo manca. */
  operazione: 'R' | 'D'
  forzatura?: DatiCobat['causa'] | null
}

/**
 * `causa` (1 carattere): carico di produzione -> 2; operazione `R*` -> 5; `D1 D3 D4 D5 D6 D7 D12` -> 3;
 * `D2 D8 D9 D10 D11 D13 D14` -> 4; `D15` -> 1; altrimenti `null` (spazio con avviso).
 */
export function causaCobat(i: InputCausa): number | null {
  if (i.forzatura) return i.forzatura
  if (i.verso === 'CARICO' && i.ruolo === 'PRODOTTO') return 2
  const codice = (i.operationCode ?? '').replace(/\s+/g, '').toUpperCase()
  if (codice.startsWith('R')) return 5
  const d = /^D0?(\d{1,2})$/.exec(codice)
  if (d) {
    const n = Number(d[1])
    if (D_TRE.has(n)) return 3
    if (D_QUATTRO.has(n)) return 4
    if (n === 15) return 1
    return null
  }
  if (codice === '' && i.operazione === 'R') return 5
  return null
}

export interface ParteCobat {
  codiceFiscale: string | null
  partitaIva: string | null
  /** Soggetto diverso dall'azienda. */
  esterno: boolean
}

export interface EsitoCodazi {
  codice: string
  soggetto: 'DESTINATARIO' | 'TRASPORTATORE' | 'PRODUTTORE'
}

/**
 * `codazi` (16): codice fiscale (o partita IVA se manca) del soggetto esterno. Precedenza ESPLICITA
 * destinatario > trasportatore > produttore. WinWaste ottiene lo stesso risultato per l'ordine di
 * valutazione («vince l'ultimo»): qui e' dichiarata e testata.
 */
export function soggettoCodazi(parti: {
  produttore: ParteCobat
  trasportatore: ParteCobat
  destinatario: ParteCobat
}): EsitoCodazi | null {
  const ordine: Array<[EsitoCodazi['soggetto'], ParteCobat]> = [
    ['DESTINATARIO', parti.destinatario],
    ['TRASPORTATORE', parti.trasportatore],
    ['PRODUTTORE', parti.produttore],
  ]
  for (const [soggetto, p] of ordine) {
    if (!p.esterno) continue
    const codice = (p.codiceFiscale?.trim() || p.partitaIva?.trim() || '').toUpperCase()
    if (codice !== '') return { codice, soggetto }
  }
  return null
}

const UNITA_LITRI = ['L', 'LT', 'LITRI', 'LITRO']
const UNITA_M3 = ['M3', 'MC', 'M³', 'METRI CUBI', 'METRO CUBO']

/**
 * Quantita' del record: `quam3` (metri cubi, solo se l'unita' e' di volume, altrimenti 0) e `quaton`
 * (tonnellate = kg / 1000). `null` se il peso non e' noto.
 */
export function quantitaCobat(
  kg: number | null,
  quantita: number,
  unita: string | null
): { quam3: number; quaton: number } | null {
  if (kg === null || !Number.isFinite(kg)) return null
  const u = (unita ?? '').trim().toUpperCase()
  let quam3 = 0
  if (UNITA_LITRI.includes(u)) quam3 = quantita / 1000
  else if (UNITA_M3.includes(u)) quam3 = quantita
  return { quam3, quaton: kg / 1000 }
}
