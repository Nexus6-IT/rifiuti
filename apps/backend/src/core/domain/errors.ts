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

export class InvalidPartitaIVAError extends DomainError {
  constructor(partitaIVA: string) {
    super(`Invalid Partita IVA format: ${partitaIVA}`)
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
 * Un FIR si ricopia nel registro una sola volta per tipo di movimento: un secondo
 * movimento dello stesso FIR con dati diversi non è un retry, è un errore da
 * correggere sul movimento già registrato.
 */
export class FirGiaRegistratoError extends DomainError {
  constructor(progressiveNumber: number, progressiveYear: number) {
    super(
      `Il FIR è già registrato nel movimento n. ${progressiveNumber}/${progressiveYear} con dati ` +
        'diversi: verificare quel movimento invece di registrarne un secondo'
    )
    this.name = 'FirGiaRegistratoError'
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
