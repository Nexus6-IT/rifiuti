/**
 * Domain Errors - Custom exceptions per business logic
 */

export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

export class InvalidEmailError extends DomainError {
  constructor(email: string) {
    super(`Invalid email format: ${email}`)
    this.name = 'InvalidEmailError'
  }
}

export class InvalidFiscalNumberError extends DomainError {
  constructor(fiscalNumber: string) {
    super(`Invalid Italian Fiscal Number format: ${fiscalNumber}`)
    this.name = 'InvalidFiscalNumberError'
  }
}

export class InvalidQuantityError extends DomainError {
  constructor(value: number) {
    super(`Quantity must be positive, got: ${value}`)
    this.name = 'InvalidQuantityError'
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(`Invalid state transition from ${from} to ${to}`)
    this.name = 'InvalidStateTransitionError'
  }
}

/** Messaggio senza il valore ricevuto: una partita IVA non entra mai in un errore (D12). */
export class InvalidPartitaIVAError extends DomainError {
  constructor() {
    super('Partita IVA non valida: servono 11 cifre.')
    this.name = 'InvalidPartitaIVAError'
  }
}

export class InvalidIndirizzoError extends DomainError {
  constructor(message: string) {
    super(`Invalid address: ${message}`)
    this.name = 'InvalidIndirizzoError'
  }
}

/**
 * Traduzione a livello di repository del vincolo di unicità database
 * (tenantId, rentriNumeroFir) su "firs" — R2 Task 3. Il vincolo applicativo
 * nell'aggregate (FIR.assertNonGiaLegatoRENTRI) copre il caso normale, ma un
 * vincolo di dominio si aggira (due richieste concorrenti passano entrambe
 * il controllo applicativo prima che una delle due scriva); il vincolo di
 * database no. Questo errore dà al chiamante (use case/controller) qualcosa
 * di leggibile invece di lasciar risalire l'eccezione Prisma grezza
 * (P2002/`Unique constraint failed`) fino al controller.
 */
export class FormularioGiaAgganciatoError extends DomainError {
  constructor(numeroFir: string) {
    super(
      `Il formulario RENTRI ${numeroFir} è già collegato a un altro FIR di questo tenant: ` +
        'rilasciare quel legame prima di agganciarlo qui'
    )
    this.name = 'FormularioGiaAgganciatoError'
  }
}

/**
 * Il FIR è stato annullato in locale (stato CANCELLED) mentre un'altra
 * operazione lo teneva in memoria con i dati di prima (tipicamente la sync
 * RENTRI, che attende l'esito per secondi o minuti). Salvare quella copia
 * riporterebbe in vita il FIR e lo renderebbe di nuovo collegabile al
 * registro: il repository rifiuta il salvataggio.
 */
export class FirAnnullatoNelFrattempoError extends DomainError {
  /** Codice e messaggio della risposta HTTP (409): è una corsa prevista, non un guasto. */
  static readonly CODICE = 'FIR_ANNULLATO_NEL_FRATTEMPO'
  static readonly MESSAGGIO_UTENTE =
    "Il FIR è stato annullato nel frattempo da un'altra operazione: ricarica la pagina per vedere lo stato aggiornato."

  constructor(firId: string) {
    super(
      `Il FIR ${firId} è stato annullato mentre era in corso un'altra operazione: ` +
        'il salvataggio non viene eseguito'
    )
    this.name = 'FirAnnullatoNelFrattempoError'
  }
}

/**
 * R3 Task 1 — `FIR.applyRentriStato` riconcilia lo `FIRStato` interno con lo
 * stato ente (`StatoFormulario`, contratto RENTRI), ma solo se il FIR ha già
 * un legame (`rentriNumeroFir` valorizzato): senza legame non c'è nulla da
 * riconciliare, e ignorare la chiamata in silenzio nasconderebbe un bug del
 * chiamante (use case Task 2-6) invece di segnalarlo subito.
 */
export class FIRNonLegatoRentriError extends DomainError {
  constructor() {
    super(
      'Impossibile riconciliare lo stato RENTRI: il FIR non è legato ad alcun formulario RENTRI ' +
        '(rentriNumeroFir assente) — agganciarlo prima di applicare uno stato ente'
    )
    this.name = 'FIRNonLegatoRentriError'
  }
}

/**
 * R3 Task 1 — da quando un FIR è legato a RENTRI, il ciclo di vita è
 * comandato dall'ente (v. `FIR.applyRentriStato`): i vecchi metodi locali
 * (`presaInCarico`, `confermaConsegna`, `annulla`) non decidono più da soli.
 * Un click locale indipendente su un FIR legato non va ignorato: va rifiutato
 * con un messaggio che indichi quale operazione RENTRI usare al suo posto.
 */
export class MetodoLocaleNonConsentitoSuFirLegatoError extends DomainError {
  constructor(operazioneLocale: string, operazioneRentriSuggerita: string) {
    super(
      `Operazione locale '${operazioneLocale}' non consentita su un FIR già legato a RENTRI: ` +
        `usa ${operazioneRentriSuggerita}`
    )
    this.name = 'MetodoLocaleNonConsentitoSuFirLegatoError'
  }
}

/**
 * Dopo l'annullamento della registrazione nata dalla ricopia di un FIR l'indice unico della ricopia
 * resta occupato e la catena e' annullata: il FIR non si puo' ricopiare di nuovo. Stessa indicazione
 * nell'avviso dell'annullamento e qui, per chi riprova la ricopia.
 */
export const INDICAZIONE_FIR_ANNULLATO =
  "Dopo l'annullamento il FIR non si può ricopiare di nuovo nel registro: se il movimento va " +
  'registrato, registralo a mano.'

/**
 * Un FIR si ricopia nel registro una sola volta per tipo di movimento: un secondo
 * movimento dello stesso FIR con dati diversi non è un retry, è un errore da
 * correggere sul movimento già registrato.
 */
export class FirGiaRegistratoError extends DomainError {
  /** `poi`: la registrazione ordinaria citata non e' piu' vigente (rettificata o annullata). */
  constructor(
    progressiveNumber: number,
    progressiveYear: number,
    denominazioneRegistro?: string,
    poi?: 'rettificato' | 'annullato'
  ) {
    super(
      `Il FIR è già registrato nel movimento n. ${progressiveNumber}/${progressiveYear}` +
        (poi ? `, poi ${poi}` : '') +
        (denominazioneRegistro ? ` nel registro ${denominazioneRegistro}` : '') +
        (poi === 'annullato'
          ? ' con dati diversi. ' + INDICAZIONE_FIR_ANNULLATO
          : ' con dati diversi: verificare quel movimento invece di registrarne un secondo')
    )
    this.name = 'FirGiaRegistratoError'
  }
}

/** Il FIR e' gia' ricopiato in un registro diverso da quello richiesto (D10): una sola ricopia per azienda. */
export class FirGiaRegistratoInAltroRegistroError extends DomainError {
  constructor(
    progressiveNumber: number,
    progressiveYear: number,
    denominazioneRegistro?: string,
    poi?: 'rettificato' | 'annullato'
  ) {
    super(
      `Il FIR è già registrato nel movimento n. ${progressiveNumber}/${progressiveYear}` +
        (poi ? `, poi ${poi}` : '') +
        (denominazioneRegistro
          ? ` nel registro ${denominazioneRegistro}`
          : ' in un altro registro') +
        ': un FIR si registra una sola volta, non si può registrare di nuovo in un altro registro' +
        (poi === 'annullato' ? '. ' + INDICAZIONE_FIR_ANNULLATO : '')
    )
    this.name = 'FirGiaRegistratoInAltroRegistroError'
  }
}

/**
 * Una firma del ciclo di vita senza l'utente che l'ha apposta non si può scrivere
 * (fir_signatures.user_id è obbligatorio). Il salvataggio si ferma prima di
 * toccare il database: stato e firme si salvano insieme o per niente.
 */
export class FirmaSenzaUtenteError extends DomainError {
  constructor(ruolo: string, firId: string) {
    super(
      `La firma ${ruolo} del FIR ${firId} non indica l'utente che l'ha apposta: il FIR non viene salvato`
    )
    this.name = 'FirmaSenzaUtenteError'
  }
}

export class FirNonPiuInBozzaError extends DomainError {
  /** Codice e messaggio della risposta HTTP (409), senza id. */
  static readonly CODICE = 'FIR_NON_PIU_IN_BOZZA'
  static readonly MESSAGGIO_UTENTE =
    'Il FIR non è più in bozza: è già stato emesso o annullato da un’altra operazione.'

  constructor(firId: string) {
    super(
      `Il FIR ${firId} non è più in bozza: è già stato emesso o annullato da un'altra operazione`
    )
    this.name = 'FirNonPiuInBozzaError'
  }
}

/**
 * Il FIR è stato salvato da un'altra operazione dopo che questa lo aveva letto (lock ottimistico
 * sulla colonna `versione`): salvare la copia letta sovrascriverebbe quei dati. Corsa prevista:
 * il filtro risponde 409, senza segnalazione a Bugsink.
 */
export class FirModificatoNelFrattempoError extends DomainError {
  static readonly CODICE = 'FIR_MODIFICATO_NEL_FRATTEMPO'
  static readonly MESSAGGIO_UTENTE =
    "Il FIR è stato modificato nel frattempo da un'altra operazione: ricarica per vedere i dati aggiornati e ripeti l'operazione."

  constructor(firId: string) {
    super(
      `Il FIR ${firId} è stato modificato da un'altra operazione dopo la lettura: il salvataggio non viene eseguito`
    )
    this.name = 'FirModificatoNelFrattempoError'
  }
}

export type MotivoFirNonModificabile =
  | 'LEGATO_RENTRI'
  | 'NON_BOZZA'
  | 'FIRMATO'
  | 'IN_ATTESA_FIRMA_PRODUTTORE'

/** La bozza non si può modificare (ordine dei motivi: piano D1). Risposta 409, messaggio senza id. */
export class FirNonModificabileError extends DomainError {
  static readonly CODICE = 'FIR_NON_MODIFICABILE'
  static readonly MESSAGGI: Record<MotivoFirNonModificabile, string> = {
    LEGATO_RENTRI:
      'Il FIR è legato a un formulario RENTRI: la modifica va fatta su RENTRI, non in locale.',
    NON_BOZZA: 'Un FIR emesso non si modifica: annullalo e creane uno nuovo.',
    FIRMATO:
      'Il FIR porta già una firma: modificarlo la renderebbe non più verificabile. Annulla il FIR e creane uno nuovo.',
    IN_ATTESA_FIRMA_PRODUTTORE:
      'Il FIR è in attesa della firma del produttore e non si può modificare.',
  }

  constructor(readonly motivo: MotivoFirNonModificabile) {
    super(FirNonModificabileError.MESSAGGI[motivo])
    this.name = 'FirNonModificabileError'
  }
}

/** FIR assente o di un'altra azienda. Risposta 404, messaggio senza id. */
export class FirNonTrovatoError extends DomainError {
  static readonly CODICE = 'FIR_NON_TROVATO'
  static readonly MESSAGGIO_UTENTE = 'FIR non trovato'

  constructor() {
    super(FirNonTrovatoError.MESSAGGIO_UTENTE)
    this.name = 'FirNonTrovatoError'
  }
}

// ---------------------------------------------------------------------------------------------
// Ditte e sedi delle controparti (F2-10). Nessun messaggio riporta partite IVA, codici fiscali o
// id: sono dati personali (il CF di un privato) o riferimenti che non servono a chi legge.
// ---------------------------------------------------------------------------------------------

/** Dati di una controparte non validi (identificativo fiscale, privato non produttore, nome). */
export class DatiControparteNonValidiError extends DomainError {
  static readonly CODICE = 'DATI_CONTROPARTE_NON_VALIDI'

  constructor(message: string) {
    super(message)
    this.name = 'DatiControparteNonValidiError'
  }
}

/** Partita IVA e codice fiscale indicati appartengono a due ditte diverse (o esiste gia'). */
export class DittaIdentificativiInConflittoError extends DomainError {
  static readonly CODICE = 'DITTA_IDENTIFICATIVI_IN_CONFLITTO'
  static readonly MESSAGGIO_DUE_DITTE =
    'Partita IVA e codice fiscale appartengono a due anagrafiche diverse'
  static readonly MESSAGGIO_GIA_ESISTENTE =
    "Esiste già un'anagrafica con questo identificativo fiscale"

  constructor(message: string = DittaIdentificativiInConflittoError.MESSAGGIO_DUE_DITTE) {
    super(message)
    this.name = 'DittaIdentificativiInConflittoError'
  }
}

/** L'identificativo indicato contraddice quello gia' registrato per la ditta. */
export class IdentificativoNonCorrispondenteError extends DomainError {
  static readonly CODICE = 'IDENTIFICATIVO_NON_CORRISPONDENTE'

  constructor(message: string) {
    super(message)
    this.name = 'IdentificativoNonCorrispondenteError'
  }
}

/** Sede che non si puo' disattivare o modificare (principale, predefinita di un ruolo, duplicata). */
export class SedeNonModificabileError extends DomainError {
  static readonly CODICE = 'SEDE_NON_MODIFICABILE'

  constructor(message: string) {
    super(message)
    this.name = 'SedeNonModificabileError'
  }
}

/** Ditta assente o di un'altra azienda. Risposta 404, messaggio senza id. */
export class DittaNonTrovataError extends DomainError {
  static readonly CODICE = 'DITTA_NON_TROVATA'
  static readonly MESSAGGIO_UTENTE = 'Ditta non trovata'

  constructor() {
    super(DittaNonTrovataError.MESSAGGIO_UTENTE)
    this.name = 'DittaNonTrovataError'
  }
}

/** Sede assente, di un'altra ditta o di un'altra azienda. Risposta 404, messaggio senza id. */
export class SedeNonTrovataError extends DomainError {
  static readonly CODICE = 'SEDE_NON_TROVATA'
  static readonly MESSAGGIO_UTENTE = 'Sede non trovata'

  constructor() {
    super(SedeNonTrovataError.MESSAGGIO_UTENTE)
    this.name = 'SedeNonTrovataError'
  }
}

/**
 * La sede indicata non e' una sede attiva della ditta del ruolo (D4/D9). 400, come i dati non
 * validi: il messaggio dice di che ruolo si tratta, mai quale sede o quale ditta.
 */
export class SedeNonValidaPerRuoloError extends DatiControparteNonValidiError {
  constructor(ruolo: 'produttore' | 'trasportatore' | 'destinatario' | 'cliente' | 'agente') {
    // R20: l'articolo giusto ("dell'agente", non "del agente")
    const del = ruolo === 'agente' ? "dell'" : 'del '
    super(`La sede indicata non è una sede attiva ${del}${ruolo} scelto`)
    this.name = 'SedeNonValidaPerRuoloError'
  }
}

/** 4.7: il ritiro da cui nasce il FIR non esiste (o è di un altro tenant). */
export class RitiroNonTrovatoError extends DomainError {
  static readonly CODICE = 'RITIRO_NON_TROVATO'
  constructor() {
    super('Il ritiro di origine del FIR non esiste.')
    this.name = 'RitiroNonTrovatoError'
  }
}

/** 4.7: il ritiro non è più PROGRAMMATO (annullato o non eseguito): non genera FIR. */
export class RitiroNonProgrammatoError extends DomainError {
  static readonly CODICE = 'RITIRO_NON_PROGRAMMATO'
  constructor() {
    super('Il ritiro non è più programmato: non si può generare il FIR.')
    this.name = 'RitiroNonProgrammatoError'
  }
}

/**
 * 4.7: esiste già un FIR non annullato per questo ritiro (indice unico parziale
 * `firs_ritiro_attivo_key`). È una corsa prevista (due generazioni insieme), non un guasto.
 */
export class FirGiaGeneratoDalRitiroError extends DomainError {
  static readonly CODICE = 'FIR_GIA_GENERATO_DAL_RITIRO'
  constructor() {
    super('Per questo ritiro esiste già un FIR non annullato.')
    this.name = 'FirGiaGeneratoDalRitiroError'
  }
}
