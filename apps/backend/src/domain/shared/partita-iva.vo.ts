import { DomainException } from './domain-exception'

/**
 * PartitaIva Value Object
 *
 * Represents an Italian VAT number (Partita IVA).
 * Format: 11 digits (IT prefix optional)
 *
 * Validation rules:
 * - Exactly 11 digits
 * - Passes checksum validation (Luhn algorithm variant)
 */
export class PartitaIva {
  private readonly value: string

  constructor(value: string) {
    const normalized = PartitaIva.normalize(value)
    if (!PartitaIva.isValid(normalized)) {
      throw new DomainException(`Invalid Partita IVA format: ${value}`)
    }
    this.value = normalized
  }

  getValue(): string {
    return this.value
  }

  /**
   * Normalize Partita IVA by removing IT prefix and whitespace
   */
  static normalize(partitaIva: string): string {
    if (!partitaIva) return ''
    return partitaIva.trim().replace(/^IT/i, '').replace(/\s/g, '')
  }

  /**
   * Validates Italian Partita IVA
   * Implements checksum validation
   */
  static isValid(partitaIva: string): boolean {
    const normalized = PartitaIva.normalize(partitaIva)

    // Must be exactly 11 digits
    if (!/^\d{11}$/.test(normalized)) return false

    // Checksum validation (Luhn algorithm variant for Italian VAT)
    const digits = normalized.split('').map(Number)
    let sum = 0

    for (let i = 0; i < 10; i++) {
      let digit = digits[i]
      if (i % 2 !== 0) {
        digit *= 2
        if (digit > 9) {
          digit -= 9
        }
      }
      sum += digit
    }

    const checkDigit = (10 - (sum % 10)) % 10
    return checkDigit === digits[10]
  }

  equals(other: PartitaIva): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }

  /**
   * Format with IT prefix
   */
  toFormattedString(): string {
    return `IT${this.value}`
  }
}
