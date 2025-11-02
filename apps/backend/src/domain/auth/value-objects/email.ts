/**
 * Email Value Object
 * Immutable, self-validating
 */

import { InvalidEmailError } from '../../../core/domain/errors'

export class Email {
  private readonly value: string

  private constructor(email: string) {
    this.value = email
  }

  static create(email: string): Email {
    const normalized = email.toLowerCase().trim()
    if (!this.isValid(normalized)) {
      throw new InvalidEmailError(email)
    }
    return new Email(normalized)
  }

  private static isValid(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  getValue(): string {
    return this.value
  }

  equals(other: Email): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
