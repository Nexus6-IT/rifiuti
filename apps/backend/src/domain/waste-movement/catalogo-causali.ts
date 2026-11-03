// Catalogo delle causali del registro (Fase 2 pezzo 5): risolutore unico di comportamento
// (ruolo nel MUD, operazione R/D, codice RENTRI) e di selezionabilita'. Dominio puro: niente
// Prisma, niente I/O. Le righe arrivano gia' convertite (date `AAAA-MM-GG`, ruolo come stringa).
//
// La chiave di una causale e' `(codice, verso)`, non il solo codice: RICLASSIFICAZIONE esiste
// in entrambi i versi.

export type VersoCausale = 'CARICO' | 'SCARICO'
export type RuoloMudCausale = 'PRODOTTO' | 'AVVIATO' | 'RICEVUTO_DA_TERZI' | 'ESCLUSO'

/** Riga del catalogo di sistema (tabella globale `causali_registro`). */
export interface RigaCausaleSistema {
  codice: string
  verso: VersoCausale
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  attiva: boolean
  /** Le registrazioni con questa causale entrano nella fatturazione (decisione 15). */
  fatturabile: boolean
}

/**
 * Riga delle personalizzazioni dell'azienda (`causali_registro_azienda`): PROPRIA = una versione
 * di una causale creata dall'azienda; DISATTIVAZIONE = una causale di sistema resa non
 * selezionabile.
 */
export interface RigaCausaleAzienda {
  id: string
  natura: 'PROPRIA' | 'DISATTIVAZIONE'
  codice: string
  verso: VersoCausale
  descrizione: string | null
  ruoloMud: RuoloMudCausale | null
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  /** `AAAA-MM-GG`. */
  validaDal: string | null
  /** `AAAA-MM-GG`; null = aperta. */
  validaAl: string | null
  /** null solo per natura DISATTIVAZIONE (la causale di sistema resta col suo valore). */
  fatturabile: boolean | null
}

export interface DefinizioneCausale {
  codice: string
  verso: VersoCausale
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: 'R' | 'D' | null
  ordine: number
  origine: 'SISTEMA' | 'AZIENDA'
  /** Id della versione aziendale; null per le causali di sistema. */
  versioneId: string | null
  validaDal: string | null
  validaAl: string | null
  attiva: boolean
  fatturabile: boolean
}

export type MotivoNonSelezionabile = 'SCONOSCIUTA' | 'VERSO' | 'DISATTIVATA' | 'FUORI_VALIDITA'

export type EsitoSelezionabile =
  | { ok: true; definizione: DefinizioneCausale }
  | { ok: false; motivo: MotivoNonSelezionabile }

/** Prefisso riservato alle causali create dalle aziende. */
export const PREFISSO_CAUSALE_AZIENDA = 'AZ_'

function operazioneTipizzata(valore: string | null): 'R' | 'D' | null {
  return valore === 'R' || valore === 'D' ? valore : null
}

function altroVerso(verso: VersoCausale): VersoCausale {
  return verso === 'CARICO' ? 'SCARICO' : 'CARICO'
}

function validaAlGiorno(riga: RigaCausaleAzienda, giorno: string): boolean {
  if (riga.validaDal === null || giorno < riga.validaDal) return false
  return riga.validaAl === null || giorno <= riga.validaAl
}

function daSistema(riga: RigaCausaleSistema): DefinizioneCausale {
  return {
    codice: riga.codice,
    verso: riga.verso,
    descrizione: riga.descrizione,
    ruoloMud: riga.ruoloMud,
    codiceRentri: riga.codiceRentri,
    operazione: operazioneTipizzata(riga.operazione),
    ordine: riga.ordine,
    origine: 'SISTEMA',
    versioneId: null,
    validaDal: null,
    validaAl: null,
    attiva: riga.attiva,
    fatturabile: riga.fatturabile,
  }
}

function daAzienda(riga: RigaCausaleAzienda): DefinizioneCausale {
  return {
    codice: riga.codice,
    verso: riga.verso,
    descrizione: riga.descrizione ?? riga.codice,
    ruoloMud: riga.ruoloMud ?? 'ESCLUSO',
    codiceRentri: riga.codiceRentri,
    operazione: operazioneTipizzata(riga.operazione),
    ordine: riga.ordine,
    origine: 'AZIENDA',
    versioneId: riga.id,
    validaDal: riga.validaDal,
    validaAl: riga.validaAl,
    attiva: true,
    fatturabile: riga.fatturabile ?? false,
  }
}

function confronta(a: DefinizioneCausale, b: DefinizioneCausale): number {
  if (a.ordine !== b.ordine) return a.ordine - b.ordine
  if (a.origine !== b.origine) return a.origine === 'SISTEMA' ? -1 : 1
  return a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0
}

export class CatalogoCausali {
  private readonly sistema: RigaCausaleSistema[]
  private readonly proprie: RigaCausaleAzienda[]
  private readonly disattivate: Set<string>

  constructor(sistema: RigaCausaleSistema[], azienda: RigaCausaleAzienda[]) {
    this.sistema = sistema
    this.proprie = azienda.filter(r => r.natura === 'PROPRIA')
    this.disattivate = new Set(
      azienda.filter(r => r.natura === 'DISATTIVAZIONE').map(r => chiave(r.verso, r.codice))
    )
  }

  private versioneAlGiorno(
    verso: VersoCausale,
    codice: string,
    giorno: string
  ): RigaCausaleAzienda | undefined {
    return this.proprie.find(
      r => r.verso === verso && r.codice === codice && validaAlGiorno(r, giorno)
    )
  }

  private rigaSistema(verso: VersoCausale, codice: string): RigaCausaleSistema | undefined {
    return this.sistema.find(r => r.verso === verso && r.codice === codice)
  }

  private esisteNelVerso(verso: VersoCausale, codice: string): boolean {
    return (
      this.rigaSistema(verso, codice) !== undefined ||
      this.proprie.some(r => r.verso === verso && r.codice === codice)
    )
  }

  private nonTrovata(verso: VersoCausale, codice: string): EsitoSelezionabile {
    return {
      ok: false,
      motivo: this.esisteNelVerso(altroVerso(verso), codice) ? 'VERSO' : 'SCONOSCIUTA',
    }
  }

  /**
   * Comportamento di una causale per un movimento. Con `versioneId` usa quella versione (se
   * codice e verso coincidono, altrimenti `null`); senza: codice `AZ_` -> versione valida al
   * giorno, altrimenti la riga di sistema. IGNORA `attiva` e le disattivazioni: il MUD di un
   * movimento passato non dipende dalla selezionabilita' di oggi. `null` = causale sconosciuta
   * per quel verso (il chiamante la tratta come ESCLUSO, senza codice RENTRI).
   */
  comportamento(
    verso: VersoCausale,
    codice: string,
    giorno: string,
    versioneId?: string | null
  ): DefinizioneCausale | null {
    if (versioneId) {
      const riga = this.proprie.find(r => r.id === versioneId)
      return riga && riga.codice === codice && riga.verso === verso ? daAzienda(riga) : null
    }
    if (codice.startsWith(PREFISSO_CAUSALE_AZIENDA)) {
      const riga = this.versioneAlGiorno(verso, codice, giorno)
      return riga ? daAzienda(riga) : null
    }
    const riga = this.rigaSistema(verso, codice)
    return riga ? daSistema(riga) : null
  }

  /** Se la causale si puo' scegliere per una nuova annotazione a quella data. */
  selezionabile(verso: VersoCausale, codice: string, giorno: string): EsitoSelezionabile {
    if (codice.startsWith(PREFISSO_CAUSALE_AZIENDA)) {
      const riga = this.versioneAlGiorno(verso, codice, giorno)
      if (riga) return { ok: true, definizione: daAzienda(riga) }
      if (this.proprie.some(r => r.verso === verso && r.codice === codice)) {
        return { ok: false, motivo: 'FUORI_VALIDITA' }
      }
      return this.nonTrovata(verso, codice)
    }
    const riga = this.rigaSistema(verso, codice)
    if (!riga) return this.nonTrovata(verso, codice)
    if (!riga.attiva || this.disattivate.has(chiave(verso, codice))) {
      return { ok: false, motivo: 'DISATTIVATA' }
    }
    return { ok: true, definizione: daSistema(riga) }
  }

  /** Definizioni selezionabili a quella data: per `ordine`, sistema prima di azienda, poi `codice`. */
  opzioni(verso: VersoCausale, giorno: string): DefinizioneCausale[] {
    const risultato: DefinizioneCausale[] = []
    for (const riga of this.sistema) {
      if (riga.verso !== verso || !riga.attiva) continue
      if (this.disattivate.has(chiave(verso, riga.codice))) continue
      risultato.push(daSistema(riga))
    }
    for (const riga of this.proprie) {
      if (riga.verso === verso && validaAlGiorno(riga, giorno)) risultato.push(daAzienda(riga))
    }
    return risultato.sort(confronta)
  }

  /** Descrizione per l'elenco e le risposte; per una causale fuori catalogo, il codice. */
  descrizione(
    verso: VersoCausale,
    codice: string,
    giorno: string,
    versioneId?: string | null
  ): string {
    return this.comportamento(verso, codice, giorno, versioneId)?.descrizione ?? codice
  }
}

function chiave(verso: VersoCausale, codice: string): string {
  return `${verso}|${codice}`
}
