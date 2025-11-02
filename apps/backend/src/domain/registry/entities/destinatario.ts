/**
 * Destinatario Entity
 * Rappresenta un destinatario di rifiuti nel sistema
 * Basato su Tenant con specializzazione per destinatari
 */

import { randomUUID } from 'crypto'
import { PartitaIVA } from '../value-objects/partita-iva'
import { Indirizzo } from '../value-objects/indirizzo'

export interface DestinatarioProps {
  ragioneSociale: string
  partitaIVA: PartitaIVA
  sede: Indirizzo
  numeroAutorizzazione: string // Numero autorizzazione smaltimento/recupero
  email?: string
  telefono?: string
  pec?: string
}

export interface DestinatarioRestoreProps extends DestinatarioProps {
  id: string
  createdAt: Date
  updatedAt: Date
}

export class Destinatario {
  private readonly _id: string
  private _ragioneSociale: string
  private readonly _partitaIVA: PartitaIVA
  private _sede: Indirizzo
  private _numeroAutorizzazione: string
  private _email?: string
  private _telefono?: string
  private _pec?: string
  private readonly _createdAt: Date
  private _updatedAt: Date

  private constructor(props: DestinatarioRestoreProps) {
    this._id = props.id
    this._ragioneSociale = props.ragioneSociale
    this._partitaIVA = props.partitaIVA
    this._sede = props.sede
    this._numeroAutorizzazione = props.numeroAutorizzazione
    this._email = props.email
    this._telefono = props.telefono
    this._pec = props.pec
    this._createdAt = props.createdAt
    this._updatedAt = props.updatedAt
  }

  static create(props: DestinatarioProps): Destinatario {
    const trimmedRagioneSociale = props.ragioneSociale.trim()
    const trimmedNumeroAutorizzazione = props.numeroAutorizzazione.trim()

    if (!trimmedRagioneSociale) {
      throw new Error('Ragione sociale is required')
    }

    if (!trimmedNumeroAutorizzazione) {
      throw new Error('Numero autorizzazione is required')
    }

    return new Destinatario({
      id: randomUUID(),
      ragioneSociale: trimmedRagioneSociale,
      partitaIVA: props.partitaIVA,
      sede: props.sede,
      numeroAutorizzazione: trimmedNumeroAutorizzazione,
      email: props.email,
      telefono: props.telefono,
      pec: props.pec,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: DestinatarioRestoreProps): Destinatario {
    return new Destinatario(props)
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

  get sede(): Indirizzo {
    return this._sede
  }

  get numeroAutorizzazione(): string {
    return this._numeroAutorizzazione
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

  updateSede(sede: Indirizzo): void {
    this._sede = sede
    this._updatedAt = new Date()
  }

  updateContatti(email?: string, telefono?: string, pec?: string): void {
    this._email = email
    this._telefono = telefono
    this._pec = pec
    this._updatedAt = new Date()
  }

  updateNumeroAutorizzazione(numeroAutorizzazione: string): void {
    const trimmed = numeroAutorizzazione.trim()
    if (!trimmed) {
      throw new Error('Numero autorizzazione is required')
    }
    this._numeroAutorizzazione = trimmed
    this._updatedAt = new Date()
  }
}
