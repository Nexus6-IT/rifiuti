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

/** 503 `PUSH_NON_DISPONIBILE`: le chiavi VAPID non sono configurate, le notifiche sono spente. */
export class PushNonDisponibileError extends DomainError {
  readonly code = 'PUSH_NON_DISPONIBILE'
  constructor() {
    super('Le notifiche non sono disponibili.')
    this.name = 'PushNonDisponibileError'
  }
}

/** 400 `PUSH_ENDPOINT_NON_AMMESSO`: l'indirizzo del servizio push non e' fra quelli dei browser noti. */
export class PushEndpointNonAmmessoError extends DomainError {
  readonly code = 'PUSH_ENDPOINT_NON_AMMESSO'
  constructor() {
    super('Il servizio di notifica del dispositivo non è supportato.')
    this.name = 'PushEndpointNonAmmessoError'
  }
}
