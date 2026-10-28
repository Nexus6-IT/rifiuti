/**
 * Produttore Entity
 * Rappresenta un produttore di rifiuti nel sistema
 * Basato su Tenant con specializzazione per produttori
 */

import { randomUUID } from 'crypto'
import { PartitaIVA } from '../value-objects/partita-iva'
import { Indirizzo } from '../value-objects/indirizzo'
import { partitaIvaDaVerificare } from '../value-objects/identificativo-fiscale'
import { RuoloControparte } from './sede-ditta'

export interface ProduttoreProps {
  ragioneSociale: string
  /** Ditta e sede predefinita del ruolo (F2-10). */
  dittaId: string
  sedeId: string
  /** Partita IVA della ditta; assente per un privato (solo produttore). */
  partitaIVA: PartitaIVA | null
  /** Codice fiscale della ditta (dato personale per un privato: mai in log o messaggi). */
  codiceFiscale?: string | null
  /** Sedi attive della ditta (sola lettura, valorizzato dalle letture del repository). */
  numeroSedi?: number
  /** Ruoli che la ditta ha in questa azienda (sola lettura, solo nel dettaglio). */
  ruoliDitta?: RuoloControparte[]
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
  private readonly _dittaId: string
  private readonly _sedeId: string
  private readonly _partitaIVA: PartitaIVA | null
  private readonly _codiceFiscale: string | null
  private readonly _numeroSedi: number | undefined
  private readonly _ruoliDitta: RuoloControparte[] | undefined
  private _sedeLegale: Indirizzo
  private _email?: string
  private _telefono?: string
  private _pec?: string
  private readonly _createdAt: Date
  private _updatedAt: Date

  private constructor(props: ProduttoreRestoreProps) {
    this._id = props.id
    this._ragioneSociale = props.ragioneSociale
    this._dittaId = props.dittaId
    this._sedeId = props.sedeId
    this._partitaIVA = props.partitaIVA
    this._codiceFiscale = props.codiceFiscale ?? null
    this._numeroSedi = props.numeroSedi
    this._ruoliDitta = props.ruoliDitta
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
      dittaId: props.dittaId,
      sedeId: props.sedeId,
      partitaIVA: props.partitaIVA,
      codiceFiscale: props.codiceFiscale,
      numeroSedi: props.numeroSedi,
      ruoliDitta: props.ruoliDitta,
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

  get dittaId(): string {
    return this._dittaId
  }

  get sedeId(): string {
    return this._sedeId
  }

  get partitaIVA(): PartitaIVA | null {
    return this._partitaIVA
  }

  get codiceFiscale(): string | null {
    return this._codiceFiscale
  }

  /** Privato: solo codice fiscale di 16 caratteri, nessuna partita IVA (ammesso solo produttore). */
  get privato(): boolean {
    return (
      this._partitaIVA === null && this._codiceFiscale !== null && this._codiceFiscale.length === 16
    )
  }

  /** Partita IVA migrata che non passa il checksum: da segnalare, mai da correggere in automatico. */
  get partitaIvaDaVerificare(): boolean {
    return partitaIvaDaVerificare(this._partitaIVA?.getValue())
  }

  get numeroSedi(): number | undefined {
    return this._numeroSedi
  }

  get ruoliDitta(): RuoloControparte[] | undefined {
    return this._ruoliDitta
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
