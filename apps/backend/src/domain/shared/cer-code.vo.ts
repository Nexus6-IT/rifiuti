import { DomainException } from './domain-exception'

/**
 * CERCode Value Object
 *
 * Represents a European Waste Catalogue code (CER/EWC code).
 * Format: 6 digits in pattern XX XX XX (spaces optional)
 *
 * Examples:
 * - 15 01 02 - Plastic packaging
 * - 17 01 07 - Mixed construction waste
 * - 20 03 01 - Mixed municipal waste
 *
 * Validation rules:
 * - Exactly 6 digits
 * - Format: 2 digits (chapter) + 2 digits (subchapter) + 2 digits (specific code)
 * - Valid chapter codes (01-20)
 */
export class CERCode {
  private readonly value: string

  constructor(value: string) {
    const normalized = CERCode.normalize(value)
    if (!CERCode.isValid(normalized)) {
      throw new DomainException(`Invalid CER code format: ${value}`)
    }
    this.value = normalized
  }

  getValue(): string {
    return this.value
  }

  /**
   * Normalize CER code by removing spaces and non-digits
   */
  static normalize(cerCode: string): string {
    if (!cerCode) return ''
    return cerCode.trim().replace(/\s/g, '').replace(/[^\d]/g, '')
  }

  /**
   * Validates CER code format
   */
  static isValid(cerCode: string): boolean {
    const normalized = CERCode.normalize(cerCode)

    // Must be exactly 6 digits
    if (!/^\d{6}$/.test(normalized)) return false

    // Chapter (first 2 digits) must be 01-20
    const chapter = parseInt(normalized.substring(0, 2))
    if (chapter < 1 || chapter > 20) return false

    return true
  }

  /**
   * Get CER code chapter (first 2 digits)
   */
  getChapter(): string {
    return this.value.substring(0, 2)
  }

  /**
   * Get CER code subchapter (middle 2 digits)
   */
  getSubchapter(): string {
    return this.value.substring(2, 4)
  }

  /**
   * Get specific code (last 2 digits)
   */
  getSpecificCode(): string {
    return this.value.substring(4, 6)
  }

  /**
   * Check if waste is hazardous
   * Hazardous waste codes end with odd digits in last position
   * (This is a simplified rule - actual classification is more complex)
   */
  isHazardous(): boolean {
    const lastDigit = parseInt(this.value.substring(5, 6))
    return lastDigit % 2 !== 0
  }

  equals(other: CERCode): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }

  /**
   * Format with spaces for display
   */
  toFormattedString(): string {
    return `${this.value.substring(0, 2)} ${this.value.substring(2, 4)} ${this.value.substring(4, 6)}`
  }
}
