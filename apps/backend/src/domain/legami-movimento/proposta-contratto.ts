import { elencoProposto, elenchiValidiAl } from '../listino/elenco-addebiti'
import type { AvvisoLegame, MotivoLegame } from './codici'

export interface ClienteDaFir {
  id: string
  attivo: boolean
}

/** Il cliente si propone solo dal FIR e solo se attivo; altrimenti sceglie l'utente. */
export function proponiCliente(i: { firPresente: boolean; clienteDaFir: ClienteDaFir | null }): {
  clienteId: string | null
  fonte: 'FIR' | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
} {
  const c = i.clienteDaFir
  if (c?.attivo) return { clienteId: c.id, fonte: 'FIR', motivi: [], avvisi: [] }
  return {
    clienteId: null,
    fonte: null,
    motivi: ['SENZA_CLIENTE'],
    avvisi: i.firPresente ? ['CLIENTE_NON_DA_FIR'] : [],
  }
}

export interface ContrattoCandidato {
  id: string
  clienteId: string
  stato: 'BOZZA' | 'ATTIVO' | 'SOSPESO' | 'SOSPESO_MOVIMENTI' | 'ANNULLATO'
  dataInizio: string
  dataFine: string | null
  sedeId: string | null
}

export interface EsitoContratto {
  contratto: ContrattoCandidato | null
  candidati: ContrattoCandidato[]
  motivo:
    | 'SENZA_CONTRATTO'
    | 'SEDE_SENZA_CONTRATTO'
    | 'CONTRATTO_AMBIGUO'
    | 'CONTRATTO_NON_ATTIVO'
    | null
}

/**
 * Contratto da proporre alla data del movimento (decisione 10). Validi: ATTIVO con la data in
 * `[dataInizio, dataFine]` (fine vuota = aperto). Gradini: stessa sede, poi senza sede, poi
 * `SEDE_SENZA_CONTRATTO`. Senza sede nota (`sedeId` null) valgono i contratti senza sede;
 * se ci sono solo contratti con sede, `CONTRATTO_AMBIGUO` con la lista. Mai eccezioni.
 */
export function proponiContratto(
  contratti: readonly ContrattoCandidato[],
  data: string,
  sedeId: string | null
): EsitoContratto {
  const validi = contratti.filter(
    k => k.stato === 'ATTIVO' && k.dataInizio <= data && (k.dataFine === null || data <= k.dataFine)
  )
  if (validi.length === 0) {
    const nonAttivo = contratti.some(
      k => k.stato === 'ATTIVO' || k.stato === 'SOSPESO' || k.stato === 'SOSPESO_MOVIMENTI'
    )
    return {
      contratto: null,
      candidati: [],
      motivo: nonAttivo ? 'CONTRATTO_NON_ATTIVO' : 'SENZA_CONTRATTO',
    }
  }
  const scegli = (l: ContrattoCandidato[]): EsitoContratto =>
    l.length === 1
      ? { contratto: l[0], candidati: l, motivo: null }
      : { contratto: null, candidati: l, motivo: 'CONTRATTO_AMBIGUO' }

  if (sedeId !== null) {
    const stessa = validi.filter(k => k.sedeId === sedeId)
    if (stessa.length > 0) return scegli(stessa)
  }
  const senzaSede = validi.filter(k => k.sedeId === null)
  if (senzaSede.length > 0) return scegli(senzaSede)
  if (sedeId !== null) return { contratto: null, candidati: [], motivo: 'SEDE_SENZA_CONTRATTO' }
  return { contratto: null, candidati: validi, motivo: 'CONTRATTO_AMBIGUO' }
}

export interface ElencoCandidato {
  id: string
  validoDal: string | null
  validoAl: string | null
  predefinito: boolean
}

/**
 * Elenco da proporre: validi = non scaduti (`elenchiValidiAl`) e già iniziati (`validoDal` ≤ data,
 * controllo che `elenchiValidiAl` non fa); poi `elencoProposto`. `ELENCO_SCADUTO` solo se esistono
 * elenchi e tutti sono finiti prima della data; altrimenti `SENZA_ELENCO`.
 */
export function proponiElenco(
  elenchi: readonly ElencoCandidato[],
  data: string
): {
  elenco: ElencoCandidato | null
  validi: ElencoCandidato[]
  motivo: 'SENZA_ELENCO' | 'ELENCO_SCADUTO' | null
} {
  const iniziati = elenchi.filter(e => e.validoDal === null || e.validoDal <= data)
  const validi = elenchiValidiAl(iniziati, data)
  const elenco = elencoProposto(validi, data)
  if (elenco) return { elenco, validi, motivo: null }
  const tuttiScaduti =
    elenchi.length > 0 && elenchi.every(e => e.validoAl !== null && e.validoAl < data)
  return { elenco: null, validi, motivo: tuttiScaduti ? 'ELENCO_SCADUTO' : 'SENZA_ELENCO' }
}
