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

/** 404: l'evento a cui si allega la foto non esiste (per questa azienda). */
export class EventoCampoNonTrovatoError extends DomainError {
  readonly code = 'EVENTO_CAMPO_NON_TROVATO'
  constructor() {
    super('Evento non trovato.')
    this.name = 'EventoCampoNonTrovatoError'
  }
}

/** 400: foto vuota o campi del multipart non validi (porta i messaggi). */
export class FotoCampoNonValidaError extends DomainError {
  constructor(public readonly messaggi: string[]) {
    super(messaggi.join(' '))
    this.name = 'FotoCampoNonValidaError'
  }
}

/** 413: la foto supera il tetto per foto (dopo la compressione sul telefono). */
export class FotoCampoTroppoGrandeError extends DomainError {
  readonly code = 'FOTO_TROPPO_GRANDE'
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'FotoCampoTroppoGrandeError'
  }
}

/** 415: non e' una JPEG o PNG (si guardano i primi byte, non il tipo dichiarato). */
export class FotoCampoTipoNonAmmessoError extends DomainError {
  readonly code = 'FOTO_TIPO_NON_AMMESSO'
  constructor() {
    super('Sono ammesse solo foto JPEG o PNG.')
    this.name = 'FotoCampoTipoNonAmmessoError'
  }
}

/** 422: l'impronta SHA-256 dichiarata dal telefono non corrisponde ai byte ricevuti. */
export class FotoCampoHashNonCorrispondenteError extends DomainError {
  readonly code = 'FOTO_HASH_NON_CORRISPONDENTE'
  constructor() {
    super("L'impronta della foto non corrisponde: il file e' arrivato danneggiato.")
    this.name = 'FotoCampoHashNonCorrispondenteError'
  }
}

/** 422: l'evento ha gia' il massimo di foto. */
export class FotoCampoLimiteEventoError extends DomainError {
  readonly code = 'FOTO_LIMITE_EVENTO'
  constructor(massimo: number) {
    super(`Un esito puo' avere al massimo ${massimo} foto.`)
    this.name = 'FotoCampoLimiteEventoError'
  }
}

/** 409: l'identificativo della foto e' gia' stato usato per altro contenuto, evento o utente. */
export class FotoCampoGiaUsataError extends DomainError {
  readonly code = 'FOTO_GIA_USATA'
  constructor() {
    super("L'identificativo della foto risulta gia' usato per un altro file.")
    this.name = 'FotoCampoGiaUsataError'
  }
}

/** 404: la foto non esiste (per questa azienda). */
export class FotoCampoNonTrovataError extends DomainError {
  readonly code = 'FOTO_CAMPO_NON_TROVATA'
  constructor() {
    super('Foto non trovata.')
    this.name = 'FotoCampoNonTrovataError'
  }
}
