/**
 * Produttore Entity
 * Rappresenta un produttore di rifiuti nel sistema
 * Basato su Tenant con specializzazione per produttori
 */

import { randomUUID } from 'crypto'
import { PartitaIVA } from '../value-objects/partita-iva'
import { Indirizzo } from '../value-objects/indirizzo'

export interface ProduttoreProps {
  ragioneSociale: string
  partitaIVA: PartitaIVA
  sedeLegale: Indirizzo
  email?: string
  telefono?: string
  pec?: string
}

export interface ProduttoreRestoreProps extends ProduttoreProps {
  id: string
  createdAt: Date
  updatedAt: Date
}

export class Produttore {
  private readonly _id: string
  private _ragioneSociale: string
  private readonly _partitaIVA: PartitaIVA
  private _sedeLegale: Indirizzo
  private _email?: string
  private _telefono?: string
  private _pec?: string
  private readonly _createdAt: Date
  private _updatedAt: Date

  private constructor(props: ProduttoreRestoreProps) {
    this._id = props.id
    this._ragioneSociale = props.ragioneSociale
    this._partitaIVA = props.partitaIVA
    this._sedeLegale = props.sedeLegale
    this._email = props.email
    this._telefono = props.telefono
    this._pec = props.pec
    this._createdAt = props.createdAt
    this._updatedAt = props.updatedAt
  }

  static create(props: ProduttoreProps): Produttore {
    const trimmed = props.ragioneSociale.trim()

    if (!trimmed) {
      throw new Error('Ragione sociale is required')
    }

    return new Produttore({
      id: randomUUID(),
      ragioneSociale: trimmed,
      partitaIVA: props.partitaIVA,
      sedeLegale: props.sedeLegale,
      email: props.email,
      telefono: props.telefono,
      pec: props.pec,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: ProduttoreRestoreProps): Produttore {
    return new Produttore(props)
  }

  get id(): string {
    return this._id
  }

  get ragioneSociale(): string {
    return this._ragioneSociale
  }

  get partitaIVA(): PartitaIVA {
    return this._partitaIVA
  }

  get sedeLegale(): Indirizzo {
    return this._sedeLegale
  }

  get email(): string | undefined {
    return this._email
  }

  get telefono(): string | undefined {
    return this._telefono
  }

  get pec(): string | undefined {
    return this._pec
  }

  get createdAt(): Date {
    return this._createdAt
  }

  get updatedAt(): Date {
    return this._updatedAt
  }

  // Business methods
  updateRagioneSociale(ragioneSociale: string): void {
    const trimmed = ragioneSociale.trim()
    if (!trimmed) {
      throw new Error('Ragione sociale is required')
    }
    this._ragioneSociale = trimmed
    this._updatedAt = new Date()
  }

  updateSedeLegale(sedeLegale: Indirizzo): void {
    this._sedeLegale = sedeLegale
    this._updatedAt = new Date()
  }

  updateContatti(email?: string, telefono?: string, pec?: string): void {
    this._email = email
    this._telefono = telefono
    this._pec = pec
    this._updatedAt = new Date()
  }
}
