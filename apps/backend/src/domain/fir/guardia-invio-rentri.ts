/**
 * Fase 3 (3.1), D4/Q5: guardia unica per il blocco all'invio a RENTRI dei FIR importati da un altro
 * programma (WinWaste). Vale per TUTTE le scritture verso RENTRI su quel FIR (creazione del
 * formulario, accettazione, annullamento, firma, allegati, rilascio, aggancio come bersaglio): uno
 * stesso punto d'ingresso, chiamato PRIMA di ogni I/O, cosi' un FIR importato non genera mai una
 * POST finche' non e' riconciliato (3.6). Il test d'architettura `scritture-rentri-guardate.spec.ts`
 * fa fallire un nuovo punto di scrittura privo della chiamata.
 *
 * `conferma-legame-rentri` non ha la guardia di proposito: lavora solo in locale (nessuna chiamata a
 * RENTRI) e un importato non puo' avere un legame proposto (la modalita' IBRIDA non parte per lui).
 *
 * Un FIR riacquisito da RENTRI (`acquisisci-formulario-rentri`, scelta NUOVO) nasce legato e NON e'
 * un import: non ha `import_source` e non e' bloccato.
 */
import { DomainError } from '../../core/domain/errors'

export class FirBloccatoAllInvioError extends DomainError {
  /** Codice e messaggio della risposta HTTP (409), senza id e senza il motivo interno. */
  static readonly CODICE = 'FIR_BLOCCATO_ALL_INVIO'
  static readonly MESSAGGIO_UTENTE =
    "FIR importato: l'invio a RENTRI è bloccato fino alla riconciliazione"

  constructor(
    firId: string,
    readonly motivo: string | null
  ) {
    super(
      `Il FIR ${firId} e' bloccato all'invio a RENTRI${motivo ? `: ${motivo}` : ''} (importato, in attesa di riconciliazione)`
    )
    this.name = 'FirBloccatoAllInvioError'
  }
}

/** Parte del FIR che serve alla guardia (l'aggregate la soddisfa). */
export interface FirConBloccoInvio {
  readonly id: string
  readonly bloccatoInvio: boolean
  readonly motivoBloccoInvio: string | null
}

/** @throws FirBloccatoAllInvioError se il FIR e' bloccato all'invio a RENTRI */
export function verificaFirNonBloccato(fir: FirConBloccoInvio): void {
  if (fir.bloccatoInvio) throw new FirBloccatoAllInvioError(fir.id, fir.motivoBloccoInvio)
}
