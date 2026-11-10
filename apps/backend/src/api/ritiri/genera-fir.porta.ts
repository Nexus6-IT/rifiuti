/**
 * Porta verso la generazione in serie dei FIR dai ritiri (4.7, T12). Il controller dipende solo da
 * questa interfaccia: l'implementazione (`GeneraFirDaRitiriService`, T12) si lega al token in
 * `RitiriModule` al momento dell'integrazione. Fino ad allora il modulo registra un segnaposto che
 * risponde 501.
 */
export const GENERA_FIR_DA_RITIRI = Symbol('GENERA_FIR_DA_RITIRI')

export type EsitoGenerazione = 'CREATO' | 'GIA_GENERATO' | 'ERRORE'

export interface EsitoGenerazioneRiga {
  ritiroId: string
  esito: EsitoGenerazione
  firId?: string
  /** RITIRO_NON_PROGRAMMATO, CER_NON_VALIDO, SEDE_NON_VALIDA, ANAGRAFICA_MANCANTE, ERRORE_INTERNO */
  codice?: string
  messaggio?: string
}

export interface RisultatoGenerazioneFir {
  esiti: EsitoGenerazioneRiga[]
}

export interface GeneraFirDaRitiriPorta {
  genera(tenantId: string, utenteId: string, ritiroIds: string[]): Promise<RisultatoGenerazioneFir>
}
