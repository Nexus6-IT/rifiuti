/**
 * Errori di dominio delle azioni manuali sul registro verso RENTRI (F2-9, D11-D13).
 * Il controller li traduce in HTTP; i messaggi sono per l'utente: niente id ne' dati fiscali.
 */
import { DomainError } from '../../../core/domain/errors'

/** 409: la riga di trasmissione e' in uno stato che non ammette l'azione richiesta. */
export class TrasmissioneNonModificabileError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'TrasmissioneNonModificabileError'
  }
}

/** 400: identificativo del registro RENTRI mancante o in un formato diverso da `R` + 10 caratteri. */
export class IdentificativoRegistroNonValidoError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'IdentificativoRegistroNonValidoError'
  }
}

/** 409: l'identificativo e' gia' assegnato a un altro registro della stessa azienda. */
export class IdentificativoGiaUsatoError extends DomainError {
  constructor() {
    super("Questo identificativo RENTRI e' gia' assegnato a un altro registro dell'azienda.")
    this.name = 'IdentificativoGiaUsatoError'
  }
}

/** 404: l'annotazione non esiste (o non e' di questo registro/azienda). */
export class MovimentoNonTrovatoError extends DomainError {
  constructor() {
    super('Annotazione non trovata in questo registro.')
    this.name = 'MovimentoNonTrovatoError'
  }
}

/** 400: parametri dell'azione non validi (intervallo, conferma mancante, motivo vuoto...). */
export class RichiestaTrasmissioneNonValidaError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'RichiestaTrasmissioneNonValidaError'
  }
}

/** 403: l'azione e' riservata agli amministratori dell'azienda selezionata. */
export class RuoloNonAutorizzatoRentriError extends DomainError {
  constructor() {
    super("Questa operazione e' riservata agli amministratori dell'azienda.")
    this.name = 'RuoloNonAutorizzatoRentriError'
  }
}

/** Ruoli effettivi (nell'azienda selezionata) che possono configurare o dichiarare. */
export const RUOLI_AMMINISTRATORE_RENTRI: readonly string[] = ['SUPER_ADMIN', 'ADMIN']

export function richiediAmministratore(ruolo: string): void {
  if (!RUOLI_AMMINISTRATORE_RENTRI.includes(ruolo)) throw new RuoloNonAutorizzatoRentriError()
}
