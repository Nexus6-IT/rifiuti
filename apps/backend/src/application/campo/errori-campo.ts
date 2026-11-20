// Errori di dominio dell'app campo (autisti e giro). Il controller li traduce in HTTP;
// i messaggi sono per l'utente, in italiano, senza id.
import { DomainError } from '../../core/domain/errors'

export class AutistaNonTrovatoError extends DomainError {
  constructor() {
    super('Autista non trovato.')
    this.name = 'AutistaNonTrovatoError'
  }
}

/** 400: dati dell'autista non validi (porta tutti i messaggi). */
export class AutistaDatiNonValidiError extends DomainError {
  constructor(public readonly messaggi: string[]) {
    super(messaggi.join(' '))
    this.name = 'AutistaDatiNonValidiError'
  }
}

/** 409 `AUTISTA_DUPLICATO`: stesso codice fiscale, oppure utente gia' legato a un altro autista. */
export class AutistaDuplicatoError extends DomainError {
  readonly code = 'AUTISTA_DUPLICATO'
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'AutistaDuplicatoError'
  }
}

/** 403 `AUTISTA_NON_COLLEGATO`: l'utente `AUTISTA` non e' legato a nessun autista attivo. */
export class AutistaNonCollegatoError extends DomainError {
  readonly code = 'AUTISTA_NON_COLLEGATO'
  constructor() {
    super("Il tuo accesso non e' collegato a un autista attivo: contatta l'ufficio.")
    this.name = 'AutistaNonCollegatoError'
  }
}

/** 409 `EVENTO_DI_ALTRO_UTENTE`: l'identificativo dell'evento e' gia' stato usato da un altro autista. */
export class EventoCampoDiAltroUtenteError extends DomainError {
  readonly code = 'EVENTO_DI_ALTRO_UTENTE'
  constructor() {
    super("L'evento risulta gia' registrato da un altro utente.")
    this.name = 'EventoCampoDiAltroUtenteError'
  }
}
