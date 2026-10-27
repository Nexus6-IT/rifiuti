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

  equals(other: Quantita): boolean {
    return this._valore === other._valore && this._unitaMisura === other._unitaMisura
  }

  toString(): string {
    return `${this._valore} ${this._unitaMisura}`
  }
}
