import { giornoItaliano } from '../../core/time/anno-italiano'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import { convertiInKg } from '../../domain/waste-movement/unita-misura-registro'
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
   * Quota con recupero o smaltimento dedotto o non indicato. `movimenti` li conta tutti;
   * `senzaKg` sono quelli in litri o m³, che il MUD qui non converte: i loro kg mancano da `kg`.
   */
  daVerificare: { kg: number; movimenti: number; senzaKg: number }
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
  const giacenze = a.controlli.find(c => c.codice === 'GIACENZE_NON_CALCOLATE')
  const riepilogo = riepilogaAvvisi(a.controlli.filter(c => c.codice !== 'GIACENZE_NON_CALCOLATE'))

  return {
    prodottoKg: arrotondaGrammo(prodotto),
    recuperoKg: arrotondaGrammo(recupero),
    smaltimentoKg: arrotondaGrammo(smaltimento),
    perCer,
    pericolosiKg: arrotondaGrammo(pericolosi),
    daVerificare: {
      kg: arrotondaGrammo(daVerificare.reduce((s, m) => s + (m.kg ?? 0), 0)),
      movimenti: daVerificare.length,
      senzaKg: daVerificare.filter(m => m.kg === null).length,
    },
    nonConvertiti: nonConvertiti.length,
    stimatiKg: arrotondaGrammo(stimati.reduce((s, m) => s + (m.kg ?? 0), 0)),
    esclusi: { kg: riepilogo.kgInMeno, nonQuantificati: riepilogo.movimentiNonQuantificati },
    giacenzaKg: giacenze?.kgNonDichiarati ?? 0,
  }
}

/**
 * Kg grezzi degli scarichi vigenti avviati a terzi entro `al` (giorno italiano), solo unità di
 * massa. Non toglie i doppi dei FIR registrati a cavallo d'anno né le ricopie, come fa il MUD:
 * serve solo al confronto con recupero + smaltimento del MUD.
 */
export function scarichiGrezziKg(
  catalogo: CatalogoCausali,
  movimenti: MovimentoBilancio[],
  al: string
): number {
  let totale = 0
  for (const m of movimenti) {
    if (m.type !== 'SCARICO' || classificaMovimento(catalogo, m) !== 'AVVIATO') continue
    if (giornoItaliano(m.movementDate) > al) continue
    const kg = convertiInKg(m.quantity, m.unit)
    if (kg !== null) totale += kg
  }
  return arrotondaGrammo(totale)
}

/** Vero se il totale grezzo degli scarichi coincide, al grammo, con recupero + smaltimento del MUD. */
export function scarichiCoincidono(grezzoKg: number, recuperoPiuSmaltimentoKg: number): boolean {
  return Math.abs(grezzoKg - recuperoPiuSmaltimentoKg) < 0.001
}
