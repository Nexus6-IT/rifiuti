import { giornoItaliano } from '../../core/time/anno-italiano'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import { collegabilitaFir, type FirPerStato } from '../../domain/fir/stati-fir'
import { convertiInKg } from '../../domain/waste-movement/unita-misura-registro'
import {
  classificaMovimento,
  operazioneDaCatalogo,
  operazioneDaCodice,
  type MovimentoClassificabile,
} from '../mud/aggregazione/mud-regole'

// Complementi puri del bilancio: ciò che le regole del MUD non danno già (prodotto del periodo,
// preliminari R13/D15, mesi con movimenti). Nessun I/O.

export interface FirBilancio extends FirPerStato {
  wasteOperationCode: string | null
}

export interface MovimentoBilancio extends MovimentoClassificabile {
  quantity: number
  unit: string | null
  operationCode: string | null
  fir: FirBilancio | null
}

const arrotondaAlGrammo = (kg: number): number => Math.round(kg * 1000) / 1000

/** Maiuscolo senza caratteri diversi da lettere e cifre: 'R 13' -> 'R13'. */
const normalizza = (codice: string | null | undefined): string =>
  (codice ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Kg prodotti: carichi con ruolo PRODOTTO entro `al` (giorno italiano), solo unità di massa. */
export function prodottoNelPeriodo(
  catalogo: CatalogoCausali,
  movimenti: MovimentoBilancio[],
  al: string
): number {
  let totale = 0
  for (const m of movimenti) {
    if (m.type !== 'CARICO' || classificaMovimento(catalogo, m) !== 'PRODOTTO') continue
    if (giornoItaliano(m.movementDate) > al) continue
    const kg = convertiInKg(m.quantity, m.unit)
    if (kg !== null) totale += kg
  }
  return arrotondaAlGrammo(totale)
}

/**
 * 'R13' o 'D15' se lo scarico avvia a un'operazione preliminare, altrimenti null.
 * Stessa precedenza di MudAggregazioneService.recuperoOSmaltimento (privato, non importabile):
 * codice del movimento, poi operazione della causale, poi codice del FIR.
 */
export function operazionePreliminare(
  catalogo: CatalogoCausali,
  m: MovimentoBilancio
): 'R13' | 'D15' | null {
  if (m.type !== 'SCARICO' || classificaMovimento(catalogo, m) !== 'AVVIATO') return null
  if (m.fir && !collegabilitaFir(m.fir).collegabile) return null
  const lettera =
    operazioneDaCodice(m.operationCode) ??
    operazioneDaCatalogo(catalogo, m) ??
    (m.fir ? operazioneDaCodice(m.fir.wasteOperationCode) : undefined)
  const codice = normalizza(m.operationCode?.trim() ? m.operationCode : m.fir?.wasteOperationCode)
  if (codice === 'R13' && lettera === 'R') return 'R13'
  if (codice === 'D15' && lettera === 'D') return 'D15'
  return null
}

/** Kg avviati a R13 e a D15 entro `al` (giorno italiano), solo unità di massa. */
export function preliminariNelPeriodo(
  catalogo: CatalogoCausali,
  movimenti: MovimentoBilancio[],
  al: string
): { r13Kg: number; d15Kg: number } {
  let r13 = 0
  let d15 = 0
  for (const m of movimenti) {
    if (giornoItaliano(m.movementDate) > al) continue
    const operazione = operazionePreliminare(catalogo, m)
    if (!operazione) continue
    const kg = convertiInKg(m.quantity, m.unit)
    if (kg === null) continue
    if (operazione === 'R13') r13 += kg
    else d15 += kg
  }
  return { r13Kg: arrotondaAlGrammo(r13), d15Kg: arrotondaAlGrammo(d15) }
}

/** Mesi (1..12) con almeno un movimento entro `al` (giorno italiano), distinti e ordinati. */
export function mesiConMovimenti(movimenti: Array<{ movementDate: Date }>, al: string): number[] {
  const mesi = new Set<number>()
  for (const m of movimenti) {
    const giorno = giornoItaliano(m.movementDate)
    if (giorno <= al) mesi.add(Number(giorno.slice(5, 7)))
  }
  return [...mesi].sort((a, b) => a - b)
}
