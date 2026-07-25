import { AggregateRoot } from '../shared/aggregate-root'
import { DomainException } from '../shared/domain-exception'
import { DigitalSignature, SignatureRole } from './digital-signature.vo'
import { FIRSignedEvent, FIRCompletedEvent } from './events/fir-signed.event'

export class FIR extends AggregateRoot {
  /**
   * Versione corrente dello schema del documento canonico firmabile.
   * Un FIR ricostituito da dati persistiti mantiene la propria `schemaVersion`
   * (vedi `reconstitute`): se in futuro il documento cambia forma (nuovi campi,
   * riorganizzazione), i FIR già esistenti continuano a rigenerare il documento
   * con la forma con cui sono stati firmati, così le firme storiche restano
   * verificabili invece di risultare falsamente compromesse.
   */
  static readonly CURRENT_SCHEMA_VERSION = 1

  private id: string
  private firNumber: string
  private tenantId: string
  private schemaVersion: number

  // Produttore (Campo 4/6 FIR) — snapshot anagrafico immutabile
  private producerPartitaIva: string
  private producerName: string | null
  private producerAddress: string | null
  private producerContact: string | null

  // Trasportatore (Campo 7 FIR) — snapshot anagrafico immutabile
  private carrierPartitaIva: string | null
  private carrierName: string | null
  private carrierVehiclePlate: string | null
  private carrierContact: string | null

  // Destinatario (Campo 9/10 FIR) — snapshot anagrafico immutabile
  private receiverPartitaIva: string | null
  private receiverName: string | null
  private receiverAddress: string | null
  private receiverContact: string | null

  // Rifiuto (Campo 2/3 FIR)
  private cerCode: string
  private wasteDescription: string | null
  private wasteCategory: string | null
  private quantity: number
  private unit: string
  private wasteOperationType: string | null
  private wastePhysicalState: string | null
  private wasteHazardClasses: string | null
  private wastePackageCount: number | null
  private wasteOperationCode: string | null
  /** Campo 17 FIR: annotazioni libere. */
  private wasteNotes: string | null

  // Trasporto
  private transportDate: Date | string | null
  private estimatedArrivalDate: Date | string | null
  private transportNotes: string | null

  private status: string = 'DRAFT'
  private signatures: DigitalSignature[] = []

  private constructor(params: any) {
    super()
    this.id = params.id
    // `firNumber` è assegnato solo all'emissione (BOZZA -> EMESSO): NON deve
    // entrare nel documento canonico (vedi toSignableDocument), altrimenti una
    // firma apposta in bozza risulterebbe non più verificabile dopo l'emissione.
    this.firNumber = params.firNumber
    this.tenantId = params.tenantId
    this.schemaVersion = params.schemaVersion ?? FIR.CURRENT_SCHEMA_VERSION

    this.producerPartitaIva = params.producerPartitaIva
    this.producerName = params.producerName ?? null
    this.producerAddress = params.producerAddress ?? null
    this.producerContact = params.producerContact ?? null

    this.carrierPartitaIva = params.carrierPartitaIva ?? null
    this.carrierName = params.carrierName ?? null
    this.carrierVehiclePlate = params.carrierVehiclePlate ?? null
    this.carrierContact = params.carrierContact ?? null

    this.receiverPartitaIva = params.receiverPartitaIva ?? null
    this.receiverName = params.receiverName ?? null
    this.receiverAddress = params.receiverAddress ?? null
    this.receiverContact = params.receiverContact ?? null

    this.cerCode = params.cerCode
    this.wasteDescription = params.wasteDescription ?? null
    this.wasteCategory = params.wasteCategory ?? null
    this.quantity = params.quantity
    this.unit = params.unit
    this.wasteOperationType = params.wasteOperationType ?? null
    this.wastePhysicalState = params.wastePhysicalState ?? null
    this.wasteHazardClasses = params.wasteHazardClasses ?? null
    this.wastePackageCount = params.wastePackageCount ?? null
    this.wasteOperationCode = params.wasteOperationCode ?? null
    this.wasteNotes = params.wasteNotes ?? null

    this.transportDate = params.transportDate ?? null
    this.estimatedArrivalDate = params.estimatedArrivalDate ?? null
    this.transportNotes = params.transportNotes ?? null
  }

  static create(params: any): FIR {
    return new FIR(params)
  }

  /**
   * Ricostituisce un aggregate FIR da dati persistiti (DB) con le firme già caricate.
   * Bypassa le validazioni di business (i dati sono già verificati a livello DB).
   * Usato da SignatureFIRRepository.findById/findByIdPublic.
   */
  static reconstitute(params: any, existingSignatures: DigitalSignature[] = []): FIR {
    const fir = new FIR(params)
    fir.signatures = [...existingSignatures]
    return fir
  }

  applySignature(signature: DigitalSignature, userFiscalCode: string, spidLevel: number): void {
    if (spidLevel < 2) {
      throw DomainException.businessRuleViolation(
        'INSUFFICIENT_SPID_LEVEL',
        'SPID Level 2 or higher required for signatures'
      )
    }

    if (this.isImmutable()) {
      throw DomainException.businessRuleViolation('FIR_IMMUTABLE', 'Cannot modify completed FIR')
    }

    const role = signature.getRole()
    if (this.hasSignatureFor(role)) {
      throw DomainException.businessRuleViolation(
        'DUPLICATE_SIGNATURE',
        `${role} already signed this FIR`
      )
    }

    if (role === 'CARRIER' && !this.hasSignatureFor('PRODUCER')) {
      throw DomainException.businessRuleViolation(
        'INVALID_SIGNATURE_ORDER',
        'Producer must sign first'
      )
    }

    if (role === 'RECEIVER' && !this.hasSignatureFor('CARRIER')) {
      throw DomainException.businessRuleViolation(
        'INVALID_SIGNATURE_ORDER',
        'Carrier must sign before receiver'
      )
    }

    this.signatures.push(signature)
    this.updateStatus()

    this.addDomainEvent(
      new FIRSignedEvent({
        aggregateId: this.id,
        firId: this.id,
        firNumber: this.firNumber,
        tenantId: this.tenantId,
        role,
        signerFiscalCode: signature.getSignerFiscalCode(),
        signerName: signature.getSignerName(),
        signatureMethod: signature.getSignatureMethod(),
        signedAt: signature.getSignedAt(),
        newStatus: this.status,
      })
    )

    if (this.isImmutable()) {
      this.addDomainEvent(
        new FIRCompletedEvent({
          aggregateId: this.id,
          firId: this.id,
          firNumber: this.firNumber,
          tenantId: this.tenantId,
          completedAt: new Date(),
          signatureCount: this.signatures.length,
        })
      )
    }
  }

  isImmutable(): boolean {
    return (
      this.signatures.length === 3 &&
      this.hasSignatureFor('PRODUCER') &&
      this.hasSignatureFor('CARRIER') &&
      this.hasSignatureFor('RECEIVER')
    )
  }

  private hasSignatureFor(role: SignatureRole): boolean {
    return this.signatures.some(sig => sig.getRole() === role)
  }

  private updateStatus(): void {
    if (this.isImmutable()) {
      this.status = 'COMPLETED'
    } else if (this.hasSignatureFor('CARRIER')) {
      this.status = 'IN_TRANSIT'
    } else if (this.hasSignatureFor('PRODUCER')) {
      this.status = 'SIGNED_BY_PRODUCER'
    }
  }

  getId(): string {
    return this.id
  }
  getTenantId(): string {
    return this.tenantId
  }
  getFirNumber(): string {
    return this.firNumber
  }
  getSignatures(): DigitalSignature[] {
    return [...this.signatures]
  }
  getStatus(): string {
    return this.status
  }
  getSchemaVersion(): number {
    return this.schemaVersion
  }

  /**
   * Genera la rappresentazione canonica del FIR da firmare/verificare.
   * Restituisce una stringa deterministica (JSON con chiavi ordinate, date
   * normalizzate in ISO-8601) che può essere hashata e firmata.
   *
   * Campi INTENZIONALMENTE esclusi (non fanno parte del contenuto legale
   * "congelato" al momento della firma, ma di metadati di workflow che
   * cambiano nel tempo — includerli romperebbe le firme precedenti):
   *  - `firNumber`: assegnato solo all'emissione (BOZZA -> EMESSO)
   *  - `status`: cambia ad ogni firma applicata (SIGNED_BY_PRODUCER, IN_TRANSIT, ...)
   *  - qualunque timestamp "di lettura" (non è mai incluso: nessun `new Date()`
   *    qui dentro, solo campi persistiti sul FIR stesso)
   *
   * Versionamento: il documento include `schemaVersion`. Un FIR ricostituito
   * mantiene la versione con cui è stato creato (vedi costruttore), quindi se
   * in futuro questo metodo cambia forma per schemaVersion >= 2, i FIR con
   * schemaVersion 1 devono continuare a essere renderizzati con la forma qui
   * sotto (aggiungere un ramo `if (this.schemaVersion >= 2) {...}` che non
   * tocca il ramo esistente, invece di sostituirlo).
   */
  toSignableDocument(): string {
    const document: Record<string, unknown> = {
      schemaVersion: this.schemaVersion,
      id: this.id,
      tenantId: this.tenantId,

      producerPartitaIva: this.producerPartitaIva,
      producerName: this.producerName,
      producerAddress: this.producerAddress,
      producerContact: this.producerContact,

      carrierPartitaIva: this.carrierPartitaIva,
      carrierName: this.carrierName,
      carrierVehiclePlate: this.carrierVehiclePlate,
      carrierContact: this.carrierContact,

      receiverPartitaIva: this.receiverPartitaIva,
      receiverName: this.receiverName,
      receiverAddress: this.receiverAddress,
      receiverContact: this.receiverContact,

      cerCode: this.cerCode,
      wasteDescription: this.wasteDescription,
      wasteCategory: this.wasteCategory,
      quantity: this.normalizeQuantity(this.quantity),
      unit: this.unit,
      wasteOperationType: this.wasteOperationType,
      wastePhysicalState: this.wastePhysicalState,
      wasteHazardClasses: this.wasteHazardClasses,
      wastePackageCount: this.wastePackageCount,
      wasteOperationCode: this.wasteOperationCode,
      wasteNotes: this.wasteNotes,

      transportDate: FIR.normalizeDate(this.transportDate),
      estimatedArrivalDate: FIR.normalizeDate(this.estimatedArrivalDate),
      transportNotes: this.transportNotes,
    }

    // Chiavi ordinate: rende il documento deterministico indipendentemente
    // dall'ordine di costruzione dell'oggetto.
    return JSON.stringify(document, Object.keys(document).sort())
  }

  /**
   * Normalizza un valore data/ora in stringa ISO-8601, indipendentemente dal
   * formato di input (Date o stringa già in vari formati equivalenti).
   */
  private static normalizeDate(value: Date | string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const date = value instanceof Date ? value : new Date(value)
    return date.toISOString()
  }

  /**
   * Normalizza la quantità a due decimali fissi (coerente con la precisione
   * Decimal(10,2) di persistenza), per evitare divergenze di rappresentazione
   * (es. "100" vs "100.0") tra invocazioni.
   */
  private normalizeQuantity(value: number): string {
    return Number(value).toFixed(2)
  }
}
