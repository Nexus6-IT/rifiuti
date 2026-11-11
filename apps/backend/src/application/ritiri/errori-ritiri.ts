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

/** 400: nessuno dei ritiri indicati ha un FIR attivo da stampare. */
export class NessunFirDaStampareError extends DomainError {
  constructor() {
    super('Nessuno dei ritiri indicati ha un FIR da stampare: genera prima i FIR.')
    this.name = 'NessunFirDaStampareError'
  }
}

/** 404: l'automezzo della distinta non esiste (o è di un'altra azienda). */
export class AutomezzoNonTrovatoError extends DomainError {
  constructor() {
    super('Automezzo non trovato.')
    this.name = 'AutomezzoNonTrovatoError'
  }
}

/** 400: il modello scelto non è dell'ambito giusto (il modello FIR non si usa per la distinta). */
export class ModelloAmbitoNonValidoError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'ModelloAmbitoNonValidoError'
  }
}
