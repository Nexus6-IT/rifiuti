/**
 * Quantita Value Object
 * Represents waste quantity with validation
 */

import { InvalidQuantityError } from '../../../core/domain/errors'

export enum UnitaMisura {
  KG = 'kg',
  LITRI = 'litri',
  TONNELLATE = 't',
}

export class Quantita {
  private constructor(
    private readonly _valore: number,
    private readonly _unitaMisura: UnitaMisura
  ) {}

  static create(valore: number, unitaMisura: UnitaMisura = UnitaMisura.KG): Quantita {
    if (valore <= 0) {
      throw new InvalidQuantityError(valore)
    }
    return new Quantita(valore, unitaMisura)
  }

  get valore(): number {
    return this._valore
  }

  get unitaMisura(): UnitaMisura {
    return this._unitaMisura
  }

  // Check if actual weight is within tolerance (±10%)
  isWithinTolerance(actual: number, tolerancePercent: number = 10): boolean {
    const tolerance = (this._valore * tolerancePercent) / 100
    const diff = Math.abs(actual - this._valore)
    return diff <= tolerance
  }

  equals(other: Quantita): boolean {
    return this._valore === other._valore && this._unitaMisura === other._unitaMisura
  }

  toString(): string {
    return `${this._valore} ${this._unitaMisura}`
  }
}
