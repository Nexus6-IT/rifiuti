/**
 * Trasportatore Entity
 * Rappresenta un trasportatore di rifiuti nel sistema
 * Basato su Tenant con specializzazione per trasportatori
 */

import { randomUUID } from 'crypto'
import { PartitaIVA } from '../value-objects/partita-iva'
import { Indirizzo } from '../value-objects/indirizzo'

export interface TrasportatoreProps {
  ragioneSociale: string
  partitaIVA: PartitaIVA
  sedeLegale: Indirizzo
  numeroIscrizione: string // Numero iscrizione albo gestori
  email?: string
  telefono?: string
  pec?: string
  // Scadenza dell'iscrizione all'Albo Gestori Ambientali. Facoltativa: le
  // anagrafiche esistenti non hanno questo dato, e non va inventata (Task 3
  // dello scadenzario). Senza valore, il controllo periodico delle scadenze
  // non genera alcun avviso per questo trasportatore.
  scadenzaIscrizione?: Date
}

export interface TrasportatoreRestoreProps extends TrasportatoreProps {
  id: string
  createdAt: Date
  updatedAt: Date
}

export class Trasportatore {
  private readonly _id: string
  private _ragioneSociale: string
  private readonly _partitaIVA: PartitaIVA
  private _sedeLegale: Indirizzo
  private _numeroIscrizione: string
  private _email?: string
  private _telefono?: string
  private _pec?: string
  private _scadenzaIscrizione?: Date
  private readonly _createdAt: Date
  private _updatedAt: Date

  private constructor(props: TrasportatoreRestoreProps) {
    this._id = props.id
    this._ragioneSociale = props.ragioneSociale
    this._partitaIVA = props.partitaIVA
    this._sedeLegale = props.sedeLegale
    this._numeroIscrizione = props.numeroIscrizione
    this._email = props.email
    this._telefono = props.telefono
    this._pec = props.pec
    this._scadenzaIscrizione = props.scadenzaIscrizione
    this._createdAt = props.createdAt
    this._updatedAt = props.updatedAt
  }

  static create(props: TrasportatoreProps): Trasportatore {
    const trimmedRagioneSociale = props.ragioneSociale.trim()
    const trimmedNumeroIscrizione = props.numeroIscrizione.trim()

    if (!trimmedRagioneSociale) {
      throw new Error('Ragione sociale is required')
    }

    if (!trimmedNumeroIscrizione) {
      throw new Error('Numero iscrizione is required')
    }

    return new Trasportatore({
      id: randomUUID(),
      ragioneSociale: trimmedRagioneSociale,
      partitaIVA: props.partitaIVA,
      sedeLegale: props.sedeLegale,
      numeroIscrizione: trimmedNumeroIscrizione,
      email: props.email,
      telefono: props.telefono,
      pec: props.pec,
      scadenzaIscrizione: props.scadenzaIscrizione,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  static reconstitute(props: TrasportatoreRestoreProps): Trasportatore {
    return new Trasportatore(props)
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

  get numeroIscrizione(): string {
    return this._numeroIscrizione
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

  get scadenzaIscrizione(): Date | undefined {
    return this._scadenzaIscrizione
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

  updateNumeroIscrizione(numeroIscrizione: string): void {
    const trimmed = numeroIscrizione.trim()
    if (!trimmed) {
      throw new Error('Numero iscrizione is required')
    }
    this._numeroIscrizione = trimmed
    this._updatedAt = new Date()
  }

  /**
   * Aggiorna la scadenza dell'iscrizione all'Albo Gestori. `undefined` la
   * azzera esplicitamente (campo facoltativo, non c'è un valore "non
   * valido" da rifiutare come per gli altri campi obbligatori).
   */
  updateScadenzaIscrizione(scadenzaIscrizione: Date | undefined): void {
    this._scadenzaIscrizione = scadenzaIscrizione
    this._updatedAt = new Date()
  }
}
