// Errori di dominio del modulo pese. Il controller li traduce in HTTP (404/400/409/422/415):
// i messaggi sono per l'utente, in italiano, senza id né dati fiscali.
import { DomainError } from '../../core/domain/errors'

export class AccessoNonTrovatoError extends DomainError {
  constructor() {
    super('Accesso non trovato.')
    this.name = 'AccessoNonTrovatoError'
  }
}

export class StatoAccessoNonValidoError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'StatoAccessoNonValidoError'
  }
}

/** Violazione delle regole di una pesata (D7), 422: porta tutti i messaggi. */
export class RegolaPesataError extends DomainError {
  constructor(public readonly messaggi: string[]) {
    super(messaggi.join(' '))
    this.name = 'RegolaPesataError'
  }
}

export class AlibiGiaUsatoError extends DomainError {
  constructor() {
    super('Questa memoria alibi è già stata usata per una pesata di questo strumento.')
    this.name = 'AlibiGiaUsatoError'
  }
}

export class CollegamentoNonValidoError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'CollegamentoNonValidoError'
  }
}

export class AllegatoNonValidoError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'AllegatoNonValidoError'
  }
}

export class AutomezzoNonTrovatoError extends DomainError {
  constructor() {
    super('Automezzo non trovato.')
    this.name = 'AutomezzoNonTrovatoError'
  }
}

export class StrumentoNonTrovatoError extends DomainError {
  constructor() {
    super('Strumento di pesa non trovato.')
    this.name = 'StrumentoNonTrovatoError'
  }
}

/** Il trasportatore non esiste nell'azienda selezionata (anche se esiste in un'altra). */
export class TrasportatoreNonTrovatoError extends DomainError {
  constructor() {
    super('Trasportatore non trovato.')
    this.name = 'TrasportatoreNonTrovatoError'
  }
}

export class PesataNonTrovataError extends DomainError {
  constructor() {
    super('Pesata non trovata.')
    this.name = 'PesataNonTrovataError'
  }
}

/** Dati dell'anagrafica non validi (400): porta tutti i messaggi. */
export class DatiPesaNonValidiError extends DomainError {
  constructor(public readonly messaggi: string[]) {
    super(messaggi.join(' '))
    this.name = 'DatiPesaNonValidiError'
  }
}

export class AutomezzoDuplicatoError extends DomainError {
  constructor() {
    super('Esiste già un automezzo con queste targhe.')
    this.name = 'AutomezzoDuplicatoError'
  }
}

export class StrumentoDuplicatoError extends DomainError {
  constructor() {
    super('Esiste già uno strumento con questa matricola.')
    this.name = 'StrumentoDuplicatoError'
  }
}

/** Il ruolo effettivo non basta per l'operazione (403). */
export class RuoloPesaInsufficienteError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'RuoloPesaInsufficienteError'
  }
}

export class AllegatoNonTrovatoError extends DomainError {
  constructor() {
    super('Allegato non trovato.')
    this.name = 'AllegatoNonTrovatoError'
  }
}

export class CollegamentoNonTrovatoError extends DomainError {
  constructor() {
    super('Collegamento non trovato.')
    this.name = 'CollegamentoNonTrovatoError'
  }
}
