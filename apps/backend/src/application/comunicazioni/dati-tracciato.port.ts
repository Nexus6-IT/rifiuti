import type { DatiPerTracciato, TracciatoDati } from '../../domain/comunicazioni/dati-tracciato'

/**
 * Porta dei dati del tracciato per movimento (4.9c-f, D2): CONOU, COBAT, O.R.R. I dati stanno sulla
 * RADICE della catena e non toccano la marcatura per consorzio.
 */
export const DATI_TRACCIATO_SERVICE = Symbol('DATI_TRACCIATO_SERVICE')

export interface DatiTracciatoVista<T extends TracciatoDati = TracciatoDati> {
  tracciato: T
  dati: DatiPerTracciato[T]
  versioneSchema: number
  /** Istante ISO dell'ultima modifica. */
  aggiornatoIl: string
}

export interface DatiTracciatoPort {
  /** `null` se il movimento non ha dati per quel tracciato. */
  leggi<T extends TracciatoDati>(
    tenantId: string,
    movimentoId: string,
    tracciato: T
  ): Promise<DatiTracciatoVista<T> | null>
  /** Crea o sostituisce i dati; lancia `DatiTracciatoNonValidiError` se non rispettano lo schema. */
  imposta<T extends TracciatoDati>(
    tenantId: string,
    userId: string,
    movimentoId: string,
    tracciato: T,
    dati: unknown
  ): Promise<DatiTracciatoVista<T>>
  cancella(tenantId: string, movimentoId: string, tracciato: TracciatoDati): Promise<void>
}

/** Dati o tracciato non validi: risponde 400, con l'elenco degli errori. */
export class DatiTracciatoNonValidiError extends Error {
  constructor(readonly errori: string[]) {
    super(`Dati del tracciato non validi: ${errori.join('; ')}`)
    this.name = 'DatiTracciatoNonValidiError'
  }
}
