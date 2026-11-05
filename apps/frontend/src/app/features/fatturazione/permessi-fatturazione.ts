/** Permessi della fatturazione per ruolo (spec §12). Ruolo assente o sconosciuto: nessuna azione. */
export interface PermessiFatturazione {
  /** Vedere elaborazioni, documenti, scostamenti; PDF; export CSV. */
  vede: boolean
  /** Avviare, ricalcolare, scartare un'anteprima; escludere e riammettere documenti. */
  prepara: boolean
  /**
   * Definitiva, annullo, storno, «emesso», presa d'atto. Dice solo il ruolo: l'interruttore
   * dell'azienda lo legge la UI da `ElaborazioneDettaglio.definitiveAttive`.
   */
  rendeDefinitiva: boolean
  /** XML, file del gestionale, invio via API (rendono «emesso»). */
  scaricaXml: boolean
  /** Cedente, numero di partenza, mappature. */
  imposta: boolean
}

const NESSUN_PERMESSO: PermessiFatturazione = {
  vede: false,
  prepara: false,
  rendeDefinitiva: false,
  scaricaXml: false,
  imposta: false,
}

export function permessiFatturazione(ruolo: string | null | undefined): PermessiFatturazione {
  switch (ruolo) {
    case 'VIEWER':
      return { ...NESSUN_PERMESSO, vede: true }
    case 'OPERATOR':
      return { ...NESSUN_PERMESSO, vede: true, prepara: true }
    case 'ADMIN':
    case 'SUPER_ADMIN':
      return { vede: true, prepara: true, rendeDefinitiva: true, scaricaXml: true, imposta: true }
    default:
      return { ...NESSUN_PERMESSO }
  }
}
