import { giornoItaliano } from '../../core/time/anno-italiano'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import { convertiInKg } from '../../domain/waste-movement/unita-misura-registro'
import { collegabilitaFir } from '../../domain/fir/stati-fir'
import { cerCanonico } from '../../domain/waste-movement/cer-registro'
import type { MudAggregato } from '../mud/aggregazione/mud-aggregazione.service'
import {
  CODICI_RIPARTIZIONE_RD,
  riepilogaAvvisi,
  type MudEsitoControllo,
  type MudMovimentoSegnalato,
} from '../mud/aggregazione/mud-controlli'
import { classificaMovimento } from '../mud/aggregazione/mud-regole'
import type { MovimentoBilancio } from './complementi-bilancio'

// Sintesi del bilancio dall'aggregazione del MUD: i numeri sono quelli del MUD, qui si
// rileggono soltanto. Nessuna regola di conteggio è replicata.

export interface VoceCerSintesi {
  cer6: string
  cerCode: string
  pericoloso: boolean
  prodottoKg: number
}

export interface SintesiMud {
  prodottoKg: number
  recuperoKg: number
  smaltimentoKg: number
  /** Tutte le righe del MUD, cerCode canonico con * se pericoloso. */
  perCer: VoceCerSintesi[]
  pericolosiKg: number
  /**
   * Quota con recupero o smaltimento dedotto o non indicato. `movimenti` li conta tutti; `kg`
   * comprende i movimenti in litri o m³ convertiti dal MUD col peso specifico. `senzaKg` sono i
   * movimenti senza kg nemmeno così: i loro kg non sono compresi in `kg`.
   */
  daVerificare: { kg: number; movimenti: number; senzaKg: number }
  /** Kg per movimento convertito col peso specifico, per chiave (anno/numero@registro). */
  convertitiPerChiave: Record<string, number>
  /** Movimenti di UNITA_NON_DI_MASSA. */
  nonConvertiti: number
  /** Kg di CONVERTITO_CON_PESO_SPECIFICO. */
  stimatiKg: number
  esclusi: { kg: number; nonQuantificati: number }
  /** GIACENZE_NON_CALCOLATE.kgNonDichiarati, 0 se assente. */
  giacenzaKg: number
}

const arrotondaGrammo = (n: number): number => Math.round(n * 1000) / 1000

const chiave = (m: MudMovimentoSegnalato): string => `${m.registroId}|${m.anno}|${m.numero}`

/** Movimenti segnalati dai controlli con quei codici, ciascuno una volta sola. */
function movimentiDi(
  controlli: MudEsitoControllo[],
  codici: readonly string[]
): MudMovimentoSegnalato[] {
  const perChiave = new Map<string, MudMovimentoSegnalato>()
  for (const c of controlli) {
    if (!codici.includes(c.codice)) continue
    for (const m of c.movimenti ?? []) perChiave.set(chiave(m), m)
  }
  return [...perChiave.values()]
}

export function sintesiDalMud(
  a: Pick<MudAggregato, 'righe' | 'pericolosiPerCer' | 'controlli'>
): SintesiMud {
  let prodotto = 0
  let recupero = 0
  let smaltimento = 0
  let pericolosi = 0
  const perCer: VoceCerSintesi[] = a.righe.map(r => {
    prodotto += r.prodottoKg
    recupero += r.recuperoKg
    smaltimento += r.smaltimentoKg
    const pericoloso = a.pericolosiPerCer[r.cerCode] === true
    if (pericoloso) pericolosi += r.prodottoKg
    return {
      cer6: r.cerCode,
      cerCode: cerCanonico(pericoloso ? `${r.cerCode}*` : r.cerCode),
      pericoloso,
      prodottoKg: r.prodottoKg,
    }
  })

  const daVerificare = movimentiDi(a.controlli, CODICI_RIPARTIZIONE_RD)
  const nonConvertiti = movimentiDi(a.controlli, ['UNITA_NON_DI_MASSA'])
  const stimati = movimentiDi(a.controlli, ['CONVERTITO_CON_PESO_SPECIFICO'])
  const convertitiPerChiave: Record<string, number> = {}
  for (const m of stimati) convertitiPerChiave[chiave(m)] = m.kg ?? 0
  const kgDi = (m: MudMovimentoSegnalato): number | null =>
    m.kg ?? convertitiPerChiave[chiave(m)] ?? null
  const giacenze = a.controlli.find(c => c.codice === 'GIACENZE_NON_CALCOLATE')
  const riepilogo = riepilogaAvvisi(a.controlli.filter(c => c.codice !== 'GIACENZE_NON_CALCOLATE'))

  return {
    prodottoKg: arrotondaGrammo(prodotto),
    recuperoKg: arrotondaGrammo(recupero),
    smaltimentoKg: arrotondaGrammo(smaltimento),
    perCer,
    pericolosiKg: arrotondaGrammo(pericolosi),
    daVerificare: {
      kg: arrotondaGrammo(daVerificare.reduce((s, m) => s + (kgDi(m) ?? 0), 0)),
      movimenti: daVerificare.length,
      senzaKg: daVerificare.filter(m => kgDi(m) === null).length,
    },
    convertitiPerChiave,
    nonConvertiti: nonConvertiti.length,
    stimatiKg: arrotondaGrammo(stimati.reduce((s, m) => s + (m.kg ?? 0), 0)),
    esclusi: { kg: riepilogo.kgInMeno, nonQuantificati: riepilogo.movimentiNonQuantificati },
    giacenzaKg: giacenze?.kgNonDichiarati ?? 0,
  }
}

/**
 * Kg degli scarichi vigenti avviati a terzi entro `al` (giorno italiano), senza FIR annullati o in
 * bozza e con litri e m³ convertiti come nel MUD. Non toglie i doppi dei FIR a cavallo d'anno né le
 * ricopie: serve solo al confronto con recupero + smaltimento del MUD.
 */
export function scarichiGrezziKg(
  catalogo: CatalogoCausali,
  movimenti: MovimentoBilancio[],
  al: string,
  convertitiPerChiave: Record<string, number> = {}
): number {
  let totale = 0
  for (const m of movimenti) {
    if (m.type !== 'SCARICO' || classificaMovimento(catalogo, m) !== 'AVVIATO') continue
    if (giornoItaliano(m.movementDate) > al) continue
    // Come il MUD: un FIR annullato o in bozza esclude lo scarico
    if (m.fir && !collegabilitaFir(m.fir).collegabile) continue
    // Litri e m³ contano coi kg che il MUD ha ricavato dal peso specifico, se li ha ricavati
    const kg =
      convertiInKg(m.quantity, m.unit) ??
      (m.chiave ? (convertitiPerChiave[m.chiave] ?? null) : null)
    if (kg !== null) totale += kg
  }
  return arrotondaGrammo(totale)
}

/** Vero se il totale grezzo degli scarichi coincide, al grammo, con recupero + smaltimento del MUD. */
export function scarichiCoincidono(grezzoKg: number, recuperoPiuSmaltimentoKg: number): boolean {
  return Math.abs(grezzoKg - recuperoPiuSmaltimentoKg) < 0.001
}
