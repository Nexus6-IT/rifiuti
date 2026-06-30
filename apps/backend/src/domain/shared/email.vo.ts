import { DomainException } from './domain-exception'

/**
 * Email Value Object
 *
 * Represents a validated email address.
 *
 * Validation rules:
 * - Valid email format (RFC 5322 simplified)
 * - Lowercase normalized
 * - Max length 255 characters
 */
export class Email {
  private readonly value: string

  constructor(value: string) {
    const normalized = Email.normalize(value)
    if (!Email.isValid(normalized)) {
      throw new DomainException(`Invalid email format: ${value}`)
    }
    this.value = normalized
  }

  getValue(): string {
    return this.value
  }

  /**
   * Normalize email by trimming and lowercasing
   */
  static normalize(email: string): string {
    if (!email) return ''
    return email.trim().toLowerCase()
  }

  /**
   * Validates email format
   * Uses simplified RFC 5322 regex
   */
  static isValid(email: string): boolean {
    const normalized = Email.normalize(email)

    // Must not be empty and max 255 characters
    if (!normalized || normalized.length > 255) return false

    // Basic email regex (simplified RFC 5322)
    const emailRegex =
      /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
    return emailRegex.test(normalized)
  }

  /**
   * Check if email is a PEC (Posta Elettronica Certificata)
   * Italian certified email address
   */
  isPEC(): boolean {
    return this.value.endsWith('.pec.it') || this.value.includes('@pec.')
  }

  /**
   * Get domain part of email
   */
  getDomain(): string {
    return this.value.split('@')[1]
  }

  /**
   * Get local part of email (before @)
   */
  getLocalPart(): string {
    return this.value.split('@')[0]
  }

  equals(other: Email): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
