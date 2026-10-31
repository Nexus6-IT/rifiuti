/**
 * Destinatario Entity
 * Rappresenta un destinatario di rifiuti nel sistema
 * Basato su Tenant con specializzazione per destinatari
 */

import { randomUUID } from 'crypto'
import { PartitaIVA } from '../value-objects/partita-iva'
import { Indirizzo } from '../value-objects/indirizzo'
import { partitaIvaDaVerificare } from '../value-objects/identificativo-fiscale'
import { RuoloControparte } from './sede-ditta'

export interface DestinatarioProps {
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
  sede: Indirizzo
  numeroAutorizzazione: string // Numero autorizzazione smaltimento/recupero
  email?: string
  telefono?: string
  pec?: string
  // Scadenza dell'autorizzazione allo smaltimento/recupero. Facoltativa: le
  // anagrafiche esistenti non hanno questo dato, e non va inventata (Task 3
  // dello scadenzario). Senza valore, il controllo periodico delle scadenze
  // non genera alcun avviso per questo destinatario.
  scadenzaAutorizzazione?: Date
}

export interface DestinatarioRestoreProps extends DestinatarioProps {
  id: string
  createdAt: Date
  updatedAt: Date
}

export class Destinatario {
  private readonly _id: string
  private _ragioneSociale: string
  private readonly _dittaId: string
  private readonly _sedeId: string
  private readonly _partitaIVA: PartitaIVA | null
  private readonly _codiceFiscale: string | null
  private readonly _numeroSedi: number | undefined
  private readonly _ruoliDitta: RuoloControparte[] | undefined
  private _sede: Indirizzo
  private _numeroAutorizzazione: string
  private _email?: string
  private _telefono?: string
  private _pec?: string
  private _scadenzaAutorizzazione?: Date
  private readonly _createdAt: Date
  private _updatedAt: Date

  private constructor(props: DestinatarioRestoreProps) {
    this._id = props.id
    this._ragioneSociale = props.ragioneSociale
    this._dittaId = props.dittaId
    this._sedeId = props.sedeId
    this._partitaIVA = props.partitaIVA
    this._codiceFiscale = props.codiceFiscale ?? null
    this._numeroSedi = props.numeroSedi
    this._ruoliDitta = props.ruoliDitta
    this._sede = props.sede
    this._numeroAutorizzazione = props.numeroAutorizzazione
    this._email = props.email
    this._telefono = props.telefono
    this._pec = props.pec
    this._scadenzaAutorizzazione = props.scadenzaAutorizzazione
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
      dittaId: props.dittaId,
      sedeId: props.sedeId,
      partitaIVA: props.partitaIVA,
      codiceFiscale: props.codiceFiscale,
      numeroSedi: props.numeroSedi,
      ruoliDitta: props.ruoliDitta,
      sede: props.sede,
      numeroAutorizzazione: trimmedNumeroAutorizzazione,
      email: props.email,
      telefono: props.telefono,
      pec: props.pec,
      scadenzaAutorizzazione: props.scadenzaAutorizzazione,
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

  get scadenzaAutorizzazione(): Date | undefined {
    return this._scadenzaAutorizzazione
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

  /**
   * Aggiorna la scadenza dell'autorizzazione. `undefined` la azzera
   * esplicitamente (campo facoltativo, non c'è un valore "non valido" da
   * rifiutare come per gli altri campi obbligatori).
   */
  updateScadenzaAutorizzazione(scadenzaAutorizzazione: Date | undefined): void {
    this._scadenzaAutorizzazione = scadenzaAutorizzazione
    this._updatedAt = new Date()
  }
}
