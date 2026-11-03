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
   * OBBLIGATORIO. Per un legame `ESCLUSO`: il motivo dell'esclusione salvato nel legame. Se non è
   * uno dei due automatici (causale, data) l'utente ha escluso a mano (O4) e una rettifica non
   * lo riammette. `null` quando lo stato non è `ESCLUSO`; un `ESCLUSO` con `null` (o campo
   * dimenticato) conta come esclusione manuale: nel dubbio non si riammette mai.
   */
  motivoEsclusionePrima: string | null
  /** Il legame ha almeno una riga con `quantita_origine = MANUALE`. */
  haQuantitaManuali: boolean
  /** La rettifica cambia la quantità (o l'unità) del movimento. */
  quantitaCambiata: boolean
}

/**
 * ATTENZIONE: `statoDopo` è PROVVISORIO quando `ricalcolaProposta` o `ricontrollaValidita` sono veri:
 * dopo il ricalcolo il servizio DEVE passarlo da `statoDopoRicalcolo(statoDopo, { motivi, completo })`
 * e scrivere quello, mai `statoDopo` così com'è (un `CONFERMATO` con motivi viola il CHECK
 * `completo_se_confermato`).
 */
export interface EsitoCorrezione {
  statoDopo: StatoLegame | 'NESSUN_LEGAME'
  /**
   * Il servizio rifà la proposta da zero (contratto, elenco, riga, valori non congelati). Solo per
   * legame che nasce, riammissione di un `ESCLUSO` e CER cambiato (in quel caso lo stato torna
   * `PROPOSTO` e l'utente deve confermare di nuovo: i prezzi congelati si perdono con il suo consenso).
   */
  ricalcolaProposta: boolean
  /**
   * Sola data cambiata: NON si rifà la proposta. Si ricontrollano il contratto e l'elenco ATTUALI
   * del legame sulla nuova data (stessi `verificaContrattoScelto` / validità dell'elenco), senza
   * cambiarli e senza toccare i prezzi congelati o manuali (§7.5). Se non valgono più si aggiungono
   * i motivi (`CONTRATTO_NON_ATTIVO`, `ELENCO_SCADUTO`) e lo stato passa da `statoDopoRicalcolo`.
   */
  ricontrollaValidita: boolean
  /** Le righe con `quantita_origine = DA_MOVIMENTO` si ricalcolano; le MANUALE restano. */
  ricalcolaQuantitaDaMovimento: boolean
  /** Aggiorna `movimento_vigente_id` e `data_movimento` del legame. */
  aggiornaVigenteEData: boolean
  /** Legame già fatturato: si registra solo `scostamento_dopo_fattura` (testo `AVVISO_SCOSTAMENTO`). */
  scostamento: boolean
  /**
   * Avvisi da AGGIUNGERE a quelli già presenti nel legame (unione senza duplicati; `PREZZO_MANUALE`
   * e `CLIENTE_NON_DA_FIR` esistenti restano; `PREZZO_MANUALE` si riallinea con `avvisiDaRighe`).
   */
  avvisiDaAggiungere: AvvisoLegame[]
  /**
   * Da scrivere come `motivo_esclusione` quando `statoDopo` è `ESCLUSO` per una causa automatica
   * (nuova esclusione, o esclusione automatica che cambia causa). `null` = non cambiare nulla
   * (escluso a mano: resta il testo dell'utente).
   */
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

/**
 * Stato da scrivere DOPO il ricalcolo di una correzione, dati i motivi e la completezza risultanti.
 * Regola: un `CONFERMATO` resta tale solo se è ancora completo e senza motivi, altrimenti torna
 * `DA_COLLEGARE` (mai `CONFERMATO` con motivi: CHECK `completo_se_confermato`). `PROPOSTO`,
 * `DA_COLLEGARE` e un legame che nasce seguono `statoDaProposta` senza conferma. Gli altri stati
 * (`ESCLUSO`, `ANNULLATO`, fatturati) non cambiano.
 */
export function statoDopoRicalcolo(
  provvisorio: StatoLegame | 'NESSUN_LEGAME',
  i: { motivi: readonly MotivoLegame[]; completo: boolean }
): StatoLegame | 'NESSUN_LEGAME' {
  switch (provvisorio) {
    case 'CONFERMATO':
      return i.motivi.length > 0 || !i.completo ? 'DA_COLLEGARE' : 'CONFERMATO'
    case 'PROPOSTO':
    case 'DA_COLLEGARE':
    case 'NESSUN_LEGAME':
      return statoDaProposta({ ...i, confermaRichiesta: false })
    default:
      return provvisorio
  }
}

const NESSUN_EFFETTO = {
  ricalcolaProposta: false,
  ricontrollaValidita: false,
  ricalcolaQuantitaDaMovimento: false,
  aggiornaVigenteEData: false,
  scostamento: false,
  avvisiDaAggiungere: [] as AvvisoLegame[],
  motivoEsclusione: null,
} as const

function nessunEffetto(statoDopo: EsitoCorrezione['statoDopo']): EsitoCorrezione {
  return { ...NESSUN_EFFETTO, statoDopo, avvisiDaAggiungere: [] }
}

/**
 * Effetto di una correzione del registro sul legame (tabella §7.5). Un legame fatturato non
 * cambia mai: solo lo scostamento. Un annullo di catena non fatturata dà `ANNULLATO`. Una
 * rettifica dà `ESCLUSO` se la causale non è più fatturabile o la data cade prima di
 * «fatturazione da»; riammette (`DA_COLLEGARE`) un `ESCLUSO` automatico tornato idoneo; con il
 * CER cambiato rimanda alla conferma.
 */
export function esitoCorrezione(i: InputCorrezione): EsitoCorrezione {
  const e = esitoBase(i)
  if (e.ricalcolaQuantitaDaMovimento && i.haQuantitaManuali && i.quantitaCambiata) {
    // Le righe a quantità manuale non seguono la rettifica: l'utente va avvisato (§4.5).
    return { ...e, avvisiDaAggiungere: [...e.avvisiDaAggiungere, 'QUANTITA_MANUALE_NON_DERIVATA'] }
  }
  return e
}

function esitoBase(i: InputCorrezione): EsitoCorrezione {
  if (i.statoPrima !== 'NESSUN_LEGAME' && eStatoFatturato(i.statoPrima)) {
    return { ...nessunEffetto(i.statoPrima), aggiornaVigenteEData: true, scostamento: true }
  }
  if (i.statoPrima === 'ANNULLATO') return nessunEffetto('ANNULLATO')
  if (i.tipo === 'ANNULLAMENTO') {
    if (i.statoPrima === 'NESSUN_LEGAME') return nessunEffetto('NESSUN_LEGAME')
    // L'annullo è una nuova annotazione nel registro: il vigente segue sempre l'ultima testa.
    return { ...nessunEffetto('ANNULLATO'), aggiornaVigenteEData: true }
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

  // Un valore assente (undefined, campo dimenticato) o null NON è automatico: non si riammette.
  const esclusioneAutomatica = (motivo: string | null | undefined): boolean =>
    motivo === MOTIVO_ESCLUSIONE_CAUSALE || motivo === MOTIVO_ESCLUSIONE_DATA

  if (!i.causaleFatturabileDopo || (i.fatturazioneDa !== null && !dataInclusa)) {
    const motivoAutomatico = !i.causaleFatturabileDopo
      ? MOTIVO_ESCLUSIONE_CAUSALE
      : MOTIVO_ESCLUSIONE_DATA
    if (i.statoPrima === 'ESCLUSO') {
      // Già escluso: resta escluso. Se l'esclusione era automatica il motivo segue la causa di
      // adesso (causale prima di data); se l'ha scritta l'utente il suo testo non si tocca.
      return {
        ...nessunEffetto('ESCLUSO'),
        aggiornaVigenteEData: true,
        motivoEsclusione: esclusioneAutomatica(i.motivoEsclusionePrima) ? motivoAutomatico : null,
      }
    }
    return {
      ...nessunEffetto('ESCLUSO'),
      aggiornaVigenteEData: true,
      motivoEsclusione: motivoAutomatico,
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
      avvisiDaAggiungere: ['CAMBIO_CER_DA_CONFERMARE'],
    }
  }

  return {
    ...nessunEffetto(i.statoPrima),
    // Con la sola data cambiata si ricontrollano contratto ed elenco attuali, senza rifare la proposta.
    ricontrollaValidita: i.dataDopo !== i.dataPrima,
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
