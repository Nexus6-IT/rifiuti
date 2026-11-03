import {
  MOTIVO_ESCLUSIONE_CAUSALE,
  MOTIVO_ESCLUSIONE_DATA,
  eStatoFatturato,
  type AvvisoLegame,
  type MotivoLegame,
  type StatoLegame,
} from './codici'

/**
 * Macchina a stati del legame movimento (spec 4.3 §4.4 e §7.5). Dominio puro: decide solo che
 * cosa fare, le scritture e i ricalcoli li fa il servizio.
 */

export type TipoCorrezione = 'RETTIFICA' | 'ANNULLAMENTO'

export interface InputCorrezione {
  /** `NESSUN_LEGAME` = il movimento non ha (ancora) un legame. */
  statoPrima: StatoLegame | 'NESSUN_LEGAME'
  tipo: TipoCorrezione
  causaleFatturabileDopo: boolean
  cerCambiato: boolean
  /** Date `AAAA-MM-GG`: il confronto è lessicografico. */
  dataDopo: string
  fatturazioneDa: string | null
  dataPrima: string
  /**
   * Solo per un legame `ESCLUSO`: il motivo dell'esclusione. Se non è uno dei due automatici
   * (causale, data) l'utente ha escluso a mano (O4) e una rettifica non lo riammette.
   */
  motivoEsclusionePrima?: string | null
}

export interface EsitoCorrezione {
  statoDopo: StatoLegame | 'NESSUN_LEGAME'
  /** Il servizio rifà la proposta (contratto, elenco, riga, valori non congelati). */
  ricalcolaProposta: boolean
  /** Le righe con `quantita_origine = DA_MOVIMENTO` si ricalcolano; le MANUALE restano. */
  ricalcolaQuantitaDaMovimento: boolean
  /** Aggiorna `movimento_vigente_id` e `data_movimento` del legame. */
  aggiornaVigenteEData: boolean
  /** Legame già fatturato: si registra solo `scostamento_dopo_fattura` (testo `AVVISO_SCOSTAMENTO`). */
  scostamento: boolean
  avvisi: AvvisoLegame[]
  /** Valorizzato solo quando `statoDopo` diventa `ESCLUSO` per una causa automatica. */
  motivoEsclusione: string | null
}

/**
 * Stato iniziale di una proposta: con motivi o incompleta `DA_COLLEGARE`; completa `PROPOSTO`,
 * oppure `CONFERMATO` se l'utente conferma (mai con motivi: il CHECK del database lo vieta).
 */
export function statoDaProposta(i: {
  motivi: readonly MotivoLegame[]
  confermaRichiesta: boolean
  completo: boolean
}): 'DA_COLLEGARE' | 'PROPOSTO' | 'CONFERMATO' {
  if (i.motivi.length > 0 || !i.completo) return 'DA_COLLEGARE'
  return i.confermaRichiesta ? 'CONFERMATO' : 'PROPOSTO'
}

const NESSUN_EFFETTO = {
  ricalcolaProposta: false,
  ricalcolaQuantitaDaMovimento: false,
  aggiornaVigenteEData: false,
  scostamento: false,
  avvisi: [] as AvvisoLegame[],
  motivoEsclusione: null,
} as const

function nessunEffetto(statoDopo: EsitoCorrezione['statoDopo']): EsitoCorrezione {
  return { ...NESSUN_EFFETTO, statoDopo, avvisi: [] }
}

/**
 * Effetto di una correzione del registro sul legame (tabella §7.5). Un legame fatturato non
 * cambia mai: solo lo scostamento. Un annullo di catena non fatturata dà `ANNULLATO`. Una
 * rettifica dà `ESCLUSO` se la causale non è più fatturabile o la data cade prima di
 * «fatturazione da»; riammette (`DA_COLLEGARE`) un `ESCLUSO` automatico tornato idoneo; con il
 * CER cambiato rimanda alla conferma.
 */
export function esitoCorrezione(i: InputCorrezione): EsitoCorrezione {
  if (i.statoPrima !== 'NESSUN_LEGAME' && eStatoFatturato(i.statoPrima)) {
    return { ...nessunEffetto(i.statoPrima), aggiornaVigenteEData: true, scostamento: true }
  }
  if (i.statoPrima === 'ANNULLATO') return nessunEffetto('ANNULLATO')
  if (i.tipo === 'ANNULLAMENTO') {
    return nessunEffetto(i.statoPrima === 'NESSUN_LEGAME' ? 'NESSUN_LEGAME' : 'ANNULLATO')
  }

  // Rettifica di un movimento con legame non fatturato (o senza legame).
  const senzaLegame = i.statoPrima === 'NESSUN_LEGAME'
  const dataInclusa = i.fatturazioneDa === null ? !senzaLegame : i.dataDopo >= i.fatturazioneDa
  // Senza «fatturazione da» un legame esistente non ha vincolo di data; un movimento senza
  // legame non ne ottiene uno (decisione 11).

  if (senzaLegame) {
    const nasce = i.causaleFatturabileDopo && dataInclusa
    return { ...nessunEffetto('NESSUN_LEGAME'), ricalcolaProposta: nasce }
  }

  const esclusioneAutomatica = (motivo: string | null | undefined): boolean =>
    motivo === undefined ||
    motivo === null ||
    motivo === MOTIVO_ESCLUSIONE_CAUSALE ||
    motivo === MOTIVO_ESCLUSIONE_DATA

  if (!i.causaleFatturabileDopo || (i.fatturazioneDa !== null && !dataInclusa)) {
    if (i.statoPrima === 'ESCLUSO') {
      // Già escluso: resta escluso; il motivo automatico si aggiorna alla causa di adesso.
      return { ...nessunEffetto('ESCLUSO'), aggiornaVigenteEData: true }
    }
    return {
      ...nessunEffetto('ESCLUSO'),
      aggiornaVigenteEData: true,
      motivoEsclusione: !i.causaleFatturabileDopo
        ? MOTIVO_ESCLUSIONE_CAUSALE
        : MOTIVO_ESCLUSIONE_DATA,
    }
  }

  if (i.statoPrima === 'ESCLUSO') {
    if (!esclusioneAutomatica(i.motivoEsclusionePrima)) {
      return { ...nessunEffetto('ESCLUSO'), aggiornaVigenteEData: true }
    }
    return {
      ...nessunEffetto('DA_COLLEGARE'),
      ricalcolaProposta: true,
      ricalcolaQuantitaDaMovimento: true,
      aggiornaVigenteEData: true,
    }
  }

  if (i.cerCambiato) {
    return {
      ...nessunEffetto(i.statoPrima === 'CONFERMATO' ? 'PROPOSTO' : i.statoPrima),
      ricalcolaProposta: true,
      ricalcolaQuantitaDaMovimento: true,
      aggiornaVigenteEData: true,
      avvisi: ['CAMBIO_CER_DA_CONFERMARE'],
    }
  }

  return {
    ...nessunEffetto(i.statoPrima),
    // Con la sola data cambiata il contratto o l'elenco possono non valere più.
    ricalcolaProposta: i.dataDopo !== i.dataPrima,
    ricalcolaQuantitaDaMovimento: true,
    aggiornaVigenteEData: true,
  }
}

/** «Aggiorna prezzi» agisce sui legami non fatturati e non esclusi né annullati. */
export function puoAggiornarePrezzi(s: StatoLegame): boolean {
  return s === 'PROPOSTO' || s === 'CONFERMATO' || s === 'DA_COLLEGARE'
}

/** Stato dopo «escludi»; `null` se non si può (fatturato, importato, annullato, già escluso). */
export function transizioneEscludi(s: StatoLegame): StatoLegame | null {
  return puoAggiornarePrezzi(s) ? 'ESCLUSO' : null
}
