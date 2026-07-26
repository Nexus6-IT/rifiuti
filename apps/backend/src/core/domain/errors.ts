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
