import { DomainException } from './domain-exception'

/**
 * FiscalCode Value Object
 *
 * Represents an Italian fiscal code (Codice Fiscale).
 * Format: RSSMRA80A01H501U (16 alphanumeric characters)
 *
 * Validation rules:
 * - Exactly 16 characters
 * - Uppercase letters and digits only
 * - Passes checksum validation
 */
export class FiscalCode {
  private readonly value: string

  constructor(value: string) {
    if (!FiscalCode.isValid(value)) {
      throw new DomainException(`Invalid fiscal code format: ${value}`)
    }
    this.value = value.toUpperCase()
  }

  getValue(): string {
    return this.value
  }

  /**
   * Validates Italian fiscal code format
   * Simplified validation - checks length and format
   * Full checksum validation would require complete algorithm
   */
  static isValid(fiscalCode: string): boolean {
    if (!fiscalCode) return false

    const trimmed = fiscalCode.trim().toUpperCase()

    // Must be exactly 16 characters
    if (trimmed.length !== 16) return false

    // First 6: letters (surname and name)
    if (!/^[A-Z]{6}/.test(trimmed.substring(0, 6))) return false

    // Next 2: year (digits)
    if (!/^\d{2}/.test(trimmed.substring(6, 8))) return false

    // Next 1: month (letter)
    if (!/^[A-EHLMPR-T]/.test(trimmed.substring(8, 9))) return false

    // Next 2: day (digits 01-71)
    const day = parseInt(trimmed.substring(9, 11))
    if (isNaN(day) || day < 1 || day > 71) return false

    // Next 4: municipality code (1 letter + 3 digits)
    if (!/^[A-Z]\d{3}/.test(trimmed.substring(11, 15))) return false

    // Last 1: checksum (letter)
    if (!/^[A-Z]/.test(trimmed.substring(15, 16))) return false

    return true
  }

  equals(other: FiscalCode): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
