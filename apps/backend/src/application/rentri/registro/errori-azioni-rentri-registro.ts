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

/** 400: l'identificativo indicato non esiste su RENTRI (404 dell'ente). */
export class RegistroRentriNonTrovatoError extends DomainError {
  constructor() {
    super("Registro non trovato su RENTRI: controlla l'identificativo.")
    this.name = 'RegistroRentriNonTrovatoError'
  }
}

/** 409: il registro RENTRI non si puo' collegare (altra unita' locale, chiuso). */
export class RegistroRentriNonCollegabileError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'RegistroRentriNonCollegabileError'
  }
}

/** 409: il registro locale non e' legato a una sede con numero di iscrizione RENTRI. */
export class RegistroSenzaSedeRentriError extends DomainError {
  constructor() {
    super(
      "Il registro non e' legato a una sede con il numero di iscrizione RENTRI: aggiorna prima le unita' locali dalle impostazioni RENTRI."
    )
    this.name = 'RegistroSenzaSedeRentriError'
  }
}

/** 409: manca il numero di iscrizione dell'operatore (serve per leggere i registri della sede). */
export class OperatoreRentriNonConfiguratoError extends DomainError {
  constructor() {
    super(
      'Configura il numero di iscrizione RENTRI della tua azienda: Impostazioni RENTRI, Certificato e credenziali.'
    )
    this.name = 'OperatoreRentriNonConfiguratoError'
  }
}

/** 409: un'apertura su RENTRI e' gia' in corso o da verificare per questo registro. */
export class AperturaRegistroInCorsoError extends DomainError {
  constructor(messaggio = 'Apertura del registro su RENTRI già in corso: attendi qualche minuto.') {
    super(messaggio)
    this.name = 'AperturaRegistroInCorsoError'
  }
}

/** 409: il registro e' gia' collegato a un registro RENTRI. */
export class RegistroGiaCollegatoError extends DomainError {
  constructor() {
    super('Il registro è già collegato a un registro RENTRI.')
    this.name = 'RegistroGiaCollegatoError'
  }
}

/** 409: dopo un esito incerto il registro aperto non e' stato trovato o non e' univoco. */
export class AperturaRegistroNonRisoltaError extends DomainError {
  constructor(messaggio: string) {
    super(messaggio)
    this.name = 'AperturaRegistroNonRisoltaError'
  }
}

/** 409: il registro locale non e' collegato a un registro RENTRI (manca l'identificativo). */
export class RegistroNonCollegatoRentriError extends DomainError {
  constructor() {
    super('Il registro non è collegato a un registro RENTRI: collegalo o aprilo prima.')
    this.name = 'RegistroNonCollegatoRentriError'
  }
}

/** 409: il registro e' chiuso su RENTRI (eREGI E3): niente modifiche ne' invii. */
export class RegistroRentriChiusoError extends DomainError {
  constructor(messaggio = 'Il registro è già chiuso su RENTRI.') {
    super(messaggio)
    this.name = 'RegistroRentriChiusoError'
  }
}

/** 409: ci sono annotazioni in volo o da trasmettere: la chiusura le lascerebbe senza destinazione. */
export class ChiusuraRegistroNonPossibileError extends DomainError {
  constructor(
    messaggio: string,
    readonly conteggi: Readonly<Record<string, number>>
  ) {
    super(messaggio)
    this.name = 'ChiusuraRegistroNonPossibileError'
  }
}

/** 409: RENTRI non ha chiuso il registro (la prenotazione di chiusura e' stata annullata). */
export class ChiusuraRegistroNonConfermataError extends DomainError {
  constructor() {
    super(
      'RENTRI non ha chiuso il registro: risulta ancora aperto. Gli invii sono di nuovo attivi; riprova la chiusura.'
    )
    this.name = 'ChiusuraRegistroNonConfermataError'
  }
}

/** 409: non c'e' nessuna apertura in corso da abbandonare. */
export class NessunaAperturaDaAbbandonareError extends DomainError {
  constructor() {
    super("Non c'è nessuna apertura del registro su RENTRI da abbandonare.")
    this.name = 'NessunaAperturaDaAbbandonareError'
  }
}
