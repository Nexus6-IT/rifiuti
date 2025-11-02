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
