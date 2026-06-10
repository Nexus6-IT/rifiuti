/**
 * FIR Aggregate Root - Core Domain Model
 * Formulario Identificazione Rifiuti
 * Implements business rules and state transitions
 */

import { AggregateRoot, DomainEvent } from '../../../core/domain/aggregate-root'
import { DomainError, InvalidStateTransitionError } from '../../../core/domain/errors'
import { Quantita, UnitaMisura } from '../value-objects/quantita'

export enum FIRStato {
  BOZZA = 'BOZZA',
  EMESSO = 'EMESSO',
  IN_TRANSITO = 'IN_TRANSITO',
  CONSEGNATO = 'CONSEGNATO',
  ANNULLATO = 'ANNULLATO',
}

export type TipoOperazioneRifiuto = 'RECOVERY' | 'DISPOSAL'

export interface FIRRifiuto {
  cerCode: string
  quantita: Quantita
  statoFisico?: string
  caratteristichePericolo?: string
  descrizione?: string
  categoria?: string
  tipoOperazione?: TipoOperazioneRifiuto
}

/**
 * Snapshot anagrafico immutabile di una parte del FIR (produttore/
 * trasportatore/destinatario), "congelato" al momento della creazione a
 * partire dal registro. Il FIR è un documento legale: conserva i dati così
 * com'erano, non un riferimento vivo che potrebbe cambiare nel tempo.
 */
export interface ParteFIR {
  registroId?: string
  ragioneSociale: string
  partitaIva: string
  indirizzo?: string
  targaVeicolo?: string
  contatto?: string
}

export interface FirmaDigitale {
  firmatario: string
  timestamp: Date
  certificato: string
}

export interface FirmeDigitali {
  produttore?: FirmaDigitale
  trasportatore?: FirmaDigitale
  destinatario?: FirmaDigitale
}

export interface CreateFIRProps {
  produttoreId: string
  rifiuto: {
    cerCode: string
    quantita: number
    unitaMisura?: UnitaMisura
    statoFisico?: string
    caratteristichePericolo?: string
    descrizione?: string
    categoria?: string
    tipoOperazione?: TipoOperazioneRifiuto
  }
  trasportatoreId: string
  destinatarioId: string
  /** Tenant proprietario del FIR (isolamento multi-tenant). */
  tenantId?: string
  /** Utente (operatore) che crea il FIR — FK obbligatoria a User in persistenza. */
  creatoDaUserId?: string
  /** Snapshot anagrafici delle parti, presi dal registro al momento della creazione. */
  produttore?: ParteFIR
  trasportatore?: ParteFIR
  destinatario?: ParteFIR
}

// Domain Events
export class FIREmessoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.emesso'
  constructor(
    public readonly firId: string,
    public readonly numeroProgressivo: string
  ) {}
}

export class FIRPresaInCaricoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.presa_in_carico'
  constructor(public readonly firId: string) {}
}

export class FIRConsegnatoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.consegnato'
  constructor(
    public readonly firId: string,
    public readonly pesoEffettivo: number
  ) {}
}

export class FIR extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private _stato: FIRStato,
    private _numeroProgressivo: string | null,
    private readonly _produttoreId: string,
    private readonly _rifiuto: FIRRifiuto,
    private readonly _trasportatoreId: string,
    private readonly _destinatarioId: string,
    private _dataPresaCarico: Date | null,
    private _dataConsegna: Date | null,
    private _pesoEffettivo: number | null,
    private _firme: FirmeDigitali,
    private readonly _createdAt: Date,
    private readonly _creatoDaUserId: string | null = null,
    private readonly _produttore: ParteFIR | null = null,
    private readonly _trasportatore: ParteFIR | null = null,
    private readonly _destinatario: ParteFIR | null = null,
    private readonly _tenantId: string | null = null
  ) {
    super()
  }

  static create(props: CreateFIRProps): FIR {
    const rifiuto: FIRRifiuto = {
      cerCode: props.rifiuto.cerCode,
      quantita: Quantita.create(
        props.rifiuto.quantita,
        props.rifiuto.unitaMisura || UnitaMisura.KG
      ),
      statoFisico: props.rifiuto.statoFisico,
      caratteristichePericolo: props.rifiuto.caratteristichePericolo,
      descrizione: props.rifiuto.descrizione,
      categoria: props.rifiuto.categoria,
      tipoOperazione: props.rifiuto.tipoOperazione,
    }

    return new FIR(
      this.generateId(),
      FIRStato.BOZZA,
      null, // numeroProgressivo assigned on emission
      props.produttoreId,
      rifiuto,
      props.trasportatoreId,
      props.destinatarioId,
      null,
      null,
      null,
      {},
      new Date(),
      props.creatoDaUserId ?? null,
      props.produttore ?? null,
      props.trasportatore ?? null,
      props.destinatario ?? null,
      props.tenantId ?? null
    )
  }

  // Business Methods

  emetti(numeroProgressivo: string, firmaProduttore: FirmaDigitale): void {
    if (this._stato !== FIRStato.BOZZA) {
      throw new InvalidStateTransitionError(this._stato, FIRStato.EMESSO)
    }

    if (!firmaProduttore) {
      throw new DomainError('FIR requires produttore signature before emission')
    }

    this._stato = FIRStato.EMESSO
    this._numeroProgressivo = numeroProgressivo
    this._firme.produttore = firmaProduttore

    this.addDomainEvent(new FIREmessoEvent(this._id, numeroProgressivo))
  }

  presaInCarico(data: Date, firmaTrasportatore: FirmaDigitale): void {
    if (this._stato !== FIRStato.EMESSO) {
      throw new InvalidStateTransitionError(this._stato, FIRStato.IN_TRANSITO)
    }

    this._stato = FIRStato.IN_TRANSITO
    this._dataPresaCarico = data
    this._firme.trasportatore = firmaTrasportatore

    this.addDomainEvent(new FIRPresaInCaricoEvent(this._id))
  }

  confermaConsegna(pesoEffettivo: number, firmaDestinatario: FirmaDigitale): void {
    if (this._stato !== FIRStato.IN_TRANSITO) {
      throw new InvalidStateTransitionError(this._stato, FIRStato.CONSEGNATO)
    }

    // Validate peso within tolerance (±10%)
    if (!this._rifiuto.quantita.isWithinTolerance(pesoEffettivo, 10)) {
      throw new DomainError(
        `Peso effettivo (${pesoEffettivo}) eccede tolleranza 10% rispetto a quantità dichiarata (${this._rifiuto.quantita.valore})`
      )
    }

    this._stato = FIRStato.CONSEGNATO
    this._dataConsegna = new Date()
    this._pesoEffettivo = pesoEffettivo
    this._firme.destinatario = firmaDestinatario

    this.addDomainEvent(new FIRConsegnatoEvent(this._id, pesoEffettivo))
  }

  annulla(motivo: string): void {
    if (this._stato === FIRStato.CONSEGNATO) {
      throw new DomainError('Cannot annull a completed FIR')
    }

    this._stato = FIRStato.ANNULLATO
    // In production, store motivo in a separate field or event
  }

  // Getters
  get id(): string {
    return this._id
  }

  get stato(): FIRStato {
    return this._stato
  }

  get numeroProgressivo(): string | null {
    return this._numeroProgressivo
  }

  get produttoreId(): string {
    return this._produttoreId
  }

  get rifiuto(): FIRRifiuto {
    return this._rifiuto
  }

  get trasportatoreId(): string {
    return this._trasportatoreId
  }

  get destinatarioId(): string {
    return this._destinatarioId
  }

  get dataPresaCarico(): Date | null {
    return this._dataPresaCarico
  }

  get dataConsegna(): Date | null {
    return this._dataConsegna
  }

  get pesoEffettivo(): number | null {
    return this._pesoEffettivo
  }

  get firme(): FirmeDigitali {
    return this._firme
  }

  get createdAt(): Date {
    return this._createdAt
  }

  /** Tenant proprietario del FIR (isolamento multi-tenant). */
  get tenantId(): string | null {
    return this._tenantId
  }

  /** Utente (operatore) che ha creato il FIR. */
  get creatoDaUserId(): string | null {
    return this._creatoDaUserId
  }

  /** Snapshot anagrafico del produttore al momento della creazione. */
  get produttore(): ParteFIR | null {
    return this._produttore
  }

  /** Snapshot anagrafico del trasportatore al momento della creazione. */
  get trasportatore(): ParteFIR | null {
    return this._trasportatore
  }

  /** Snapshot anagrafico del destinatario al momento della creazione. */
  get destinatario(): ParteFIR | null {
    return this._destinatario
  }

  private static generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}
