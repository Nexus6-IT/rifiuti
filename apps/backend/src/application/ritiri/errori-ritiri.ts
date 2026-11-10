// Errori di dominio del servizio dei ritiri. Il controller (T13) li traduce in HTTP:
// 404, 400, 409 con `code`. I messaggi sono per l'utente, in italiano, senza id.
import { DomainError } from '../../core/domain/errors'

export class RitiroNonTrovatoError extends DomainError {
  constructor() {
    super('Ritiro non trovato.')
    this.name = 'RitiroNonTrovatoError'
  }
}

/** 400: dati del ritiro non validi (porta tutti i messaggi). */
export class RitiroDatiNonValidiError extends DomainError {
  constructor(public readonly messaggi: string[]) {
    super(messaggi.join(' '))
    this.name = 'RitiroDatiNonValidiError'
  }
}

/** 409 `RITIRO_MODIFICATO`: la `versione` letta non è più quella salvata. */
export class RitiroModificatoError extends DomainError {
  readonly code = 'RITIRO_MODIFICATO'
  constructor() {
    super('Il ritiro è stato modificato da un altro utente: ricarica e riprova.')
    this.name = 'RitiroModificatoError'
  }
}

/** 409 `RITIRO_CON_FIR`: esiste un FIR attivo, il ritiro non si tocca. */
export class RitiroConFirError extends DomainError {
  readonly code = 'RITIRO_CON_FIR'
  constructor() {
    super('Il ritiro ha un FIR attivo: annulla prima il FIR.')
    this.name = 'RitiroConFirError'
  }
}

/** 409 `RITIRO_STATO_NON_VALIDO`: l'operazione non è ammessa nello stato attuale. */
export class RitiroStatoNonValidoError extends DomainError {
  readonly code = 'RITIRO_STATO_NON_VALIDO'
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'RitiroStatoNonValidoError'
  }
}
