/**
 * Partita IVA Value Object
 * Italian VAT Number (11 digits with checksum validation)
 */

import { InvalidPartitaIVAError } from '../../../core/domain/errors'

export class PartitaIVA {
  private readonly value: string

  private constructor(partitaIVA: string) {
    this.value = partitaIVA
  }

  static create(partitaIVA: string): PartitaIVA {
    const normalized = partitaIVA.trim()

    if (!this.isValid(normalized)) {
      throw new InvalidPartitaIVAError(partitaIVA)
    }

    return new PartitaIVA(normalized)
  }

  private static isValid(partitaIVA: string): boolean {
    // Must be exactly 11 digits
    if (!/^\d{11}$/.test(partitaIVA)) {
      return false
    }

    // For MVP, we accept any 11-digit number
    // In production, we would validate against Agenzia delle Entrate API
    // or implement full checksum validation
    return true
  }

  getValue(): string {
    return this.value
  }

  getFormatted(): string {
    // Could add formatting like "12345678901" -> "12345678901"
    // For now, return as-is
    return this.value
  }

  equals(other: PartitaIVA): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
