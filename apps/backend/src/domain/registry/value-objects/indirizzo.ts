/**
 * Indirizzo Value Object
 * Italian address with validation
 */

import { InvalidIndirizzoError } from '../../../core/domain/errors'

export interface IndirizzoProps {
  via: string
  civico: string
  cap: string
  citta: string
  provincia: string
  nazione?: string
}

export class Indirizzo {
  private readonly via: string
  private readonly civico: string
  private readonly cap: string
  private readonly citta: string
  private readonly provincia: string
  private readonly nazione: string

  private constructor(props: IndirizzoProps) {
    this.via = props.via
    this.civico = props.civico
    this.cap = props.cap
    this.citta = props.citta
    this.provincia = props.provincia
    this.nazione = props.nazione || 'Italia'
  }

  static create(props: IndirizzoProps): Indirizzo {
    // Trim all fields
    const normalized = {
      via: props.via.trim(),
      civico: props.civico.trim(),
      cap: props.cap.trim(),
      citta: props.citta.trim(),
      provincia: props.provincia.trim(),
      nazione: props.nazione?.trim(),
    }

    // Validate
    if (!normalized.via) {
      throw new InvalidIndirizzoError('Via is required')
    }

    if (!normalized.civico) {
      throw new InvalidIndirizzoError('Civico is required')
    }

    // CAP must be exactly 5 digits
    if (!/^\d{5}$/.test(normalized.cap)) {
      throw new InvalidIndirizzoError('CAP must be 5 digits')
    }

    if (!normalized.citta) {
      throw new InvalidIndirizzoError('Citta is required')
    }

    // Provincia must be exactly 2 letters
    if (!/^[A-Z]{2}$/.test(normalized.provincia.toUpperCase())) {
      throw new InvalidIndirizzoError('Provincia must be 2 letters (e.g., RM, MI)')
    }

    // Normalize provincia to uppercase
    normalized.provincia = normalized.provincia.toUpperCase()

    return new Indirizzo(normalized as IndirizzoProps)
  }

  getVia(): string {
    return this.via
  }

  getCivico(): string {
    return this.civico
  }

  getCAP(): string {
    return this.cap
  }

  getCitta(): string {
    return this.citta
  }

  getProvincia(): string {
    return this.provincia
  }

  getNazione(): string {
    return this.nazione
  }

  getFormatted(): string {
    return `${this.via}, ${this.civico} - ${this.cap} ${this.citta} (${this.provincia})`
  }

  equals(other: Indirizzo): boolean {
    return (
      this.via === other.via &&
      this.civico === other.civico &&
      this.cap === other.cap &&
      this.citta === other.citta &&
      this.provincia === other.provincia &&
      this.nazione === other.nazione
    )
  }

  toString(): string {
    return this.getFormatted()
  }
}
