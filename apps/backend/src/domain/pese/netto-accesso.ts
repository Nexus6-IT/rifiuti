import { formattaQuantita } from '../../core/format/formatta-quantita'
import { formattaDataItaliana, giornoItaliano } from '../../core/time/anno-italiano'
import type { FontePesataDominio, ModoPesaturaDominio, VersoPesata } from './tipi'

export type QualitaNetto = 'DUE_PESATE' | 'TARA_DICHIARATA' | 'PESATA_SINGOLA'

export interface PesataPerNetto {
  ordine: 1 | 2
  fonte: FontePesataDominio
  /** peso originale, in kg */
  pesoKg: number
  rettifiche: { numero: number; pesoNuovoKg: number }[]
  stabile: boolean
  /** ISO, solo per la fonte TARA_ANAGRAFICA */
  taraAggiornataIl?: string | null
}

export interface EsitoNetto {
  stato: 'INCOMPLETO' | 'CALCOLATO' | 'NON_VALIDO'
  lordoKg: number | null
  taraKg: number | null
  nettoKg: number | null
  qualita: QualitaNetto | null
  manuale: boolean
  rettificato: boolean
  errore: string | null
  avvisi: string[]
}

export const AVVISO_MANUALE = 'Pesata inserita a mano: nessuna garanzia metrologica.'
export const AVVISO_TARA_DICHIARATA =
  "Netto calcolato con la tara dichiarata dell'automezzo, non con una seconda pesata."
export const AVVISO_SINGOLA = 'Pesata singola: netto letto dallo strumento.'
export const AVVISO_RETTIFICATO =
  'Peso rettificato: il valore originale resta visibile nelle rettifiche.'
export const GIORNI_TARA_VECCHIA = 365

const MS_GIORNO = 24 * 60 * 60 * 1000

/** Peso in vigore: quello dell'ultima rettifica (numero più alto), altrimenti l'originale. */
export function pesoEffettivo(p: PesataPerNetto): number {
  if (p.rettifiche.length === 0) return p.pesoKg
  let ultima = p.rettifiche[0]
  for (const r of p.rettifiche) if (r.numero > ultima.numero) ultima = r
  return ultima.pesoNuovoKg
}

const aCentesimi = (kg: number): number => Math.round(kg * 100)
const daCentesimi = (c: number): number => c / 100

function giorniTra(daIso: string, aIso: string): number {
  const a = Date.UTC(+daIso.slice(0, 4), +daIso.slice(5, 7) - 1, +daIso.slice(8, 10))
  const b = Date.UTC(+aIso.slice(0, 4), +aIso.slice(5, 7) - 1, +aIso.slice(8, 10))
  return Math.round((b - a) / MS_GIORNO)
}

function esito(parziale: Partial<EsitoNetto> & Pick<EsitoNetto, 'stato'>): EsitoNetto {
  return {
    lordoKg: null,
    taraKg: null,
    nettoKg: null,
    qualita: null,
    manuale: false,
    rettificato: false,
    errore: null,
    avvisi: [],
    ...parziale,
  }
}

/**
 * Netto di un accesso, calcolato dalle pesate (mai memorizzato).
 * Aritmetica in centesimi interi: nessun errore di virgola mobile.
 * `oggi` è YYYY-MM-DD.
 */
export function calcolaNetto(
  verso: VersoPesata,
  modo: ModoPesaturaDominio,
  pesate: readonly PesataPerNetto[],
  oggi: string
): EsitoNetto {
  const manuale = pesate.some(p => p.fonte === 'MANUALE')
  const rettificato = pesate.some(p => p.rettifiche.length > 0)
  const avvisi: string[] = []
  if (manuale) avvisi.push(AVVISO_MANUALE)
  if (rettificato) avvisi.push(AVVISO_RETTIFICATO)
  const base = { manuale, rettificato }

  if (pesate.some(p => !p.stabile)) {
    return esito({
      ...base,
      stato: 'NON_VALIDO',
      errore: 'Una pesata instabile non è un peso.',
      avvisi,
    })
  }

  const per = (ordine: 1 | 2) => pesate.find(p => p.ordine === ordine)
  const prima = per(1)
  const seconda = per(2)

  if (modo === 'SINGOLA') {
    if (!prima) return esito({ ...base, stato: 'INCOMPLETO', avvisi })
    const nettoC = aCentesimi(pesoEffettivo(prima))
    if (nettoC <= 0) {
      return esito({
        ...base,
        stato: 'NON_VALIDO',
        errore: 'Il peso netto deve essere maggiore di zero.',
        avvisi,
      })
    }
    avvisi.push(AVVISO_SINGOLA)
    return esito({
      ...base,
      stato: 'CALCOLATO',
      nettoKg: daCentesimi(nettoC),
      qualita: 'PESATA_SINGOLA',
      avvisi,
    })
  }

  if (!prima || !seconda) return esito({ ...base, stato: 'INCOMPLETO', avvisi })

  const c1 = aCentesimi(pesoEffettivo(prima))
  const c2 = aCentesimi(pesoEffettivo(seconda))
  let lordoC: number
  let taraC: number
  if (modo === 'TARA_ANAGRAFICA' || verso === 'CARICO') {
    lordoC = c1
    taraC = c2
  } else {
    // DOPPIA in scarico: il mezzo entra vuoto (tara) ed esce pieno (lordo)
    lordoC = c2
    taraC = c1
  }

  if (modo === 'TARA_ANAGRAFICA') {
    avvisi.push(AVVISO_TARA_DICHIARATA)
    const agg = seconda.taraAggiornataIl
    const istanteAgg = agg ? new Date(agg) : null
    if (istanteAgg && giorniTra(giornoItaliano(istanteAgg), oggi) > GIORNI_TARA_VECCHIA) {
      avvisi.push(
        `Tara dichiarata aggiornata il ${formattaDataItaliana(istanteAgg)}, più di ${GIORNI_TARA_VECCHIA} giorni fa.`
      )
    }
  }

  const lordoKg = daCentesimi(lordoC)
  const taraKg = daCentesimi(taraC)
  if (lordoC - taraC <= 0) {
    return esito({
      ...base,
      stato: 'NON_VALIDO',
      lordoKg,
      taraKg,
      avvisi,
      errore: `Il lordo (${formattaQuantita(lordoKg)} kg) non supera la tara (${formattaQuantita(taraKg)} kg): il netto non si può calcolare.`,
    })
  }

  return esito({
    ...base,
    stato: 'CALCOLATO',
    lordoKg,
    taraKg,
    nettoKg: daCentesimi(lordoC - taraC),
    qualita: modo === 'TARA_ANAGRAFICA' ? 'TARA_DICHIARATA' : 'DUE_PESATE',
    avvisi,
  })
}
